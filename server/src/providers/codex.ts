/**
 * Codex app-server provider.
 *
 * MDVE speaks the documented stdio JSON-RPC surface instead of reading Codex's
 * private credential/cache files or guessing the shape of `codex exec` events.
 * The installed Codex CLI owns authentication and model entitlement discovery.
 */

import { spawn, type ChildProcessWithoutNullStreams, execFile } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { promisify } from 'node:util';

import type { AgentEvent, ModelCatalog, ModelInfo, Provider, RunOptions } from './types.js';

const execFileAsync = promisify(execFile);
const CODEX_BIN = process.env.MDVE_CODEX_BIN ?? 'codex';
export const CODEX_COMPATIBILITY_RANGE = '>=0.146.0 <0.147.0';
const CLIENT_VERSION = process.env.MDVE_VERSION ?? '1.0.0';

interface JsonRpcResponse {
  id?: string | number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface JsonRpcNotification {
  method?: string;
  params?: unknown;
  id?: string | number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface CodexModel {
  id?: string;
  model?: string;
  displayName?: string;
  hidden?: boolean;
  upgrade?: string | null;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
  isDefault?: boolean;
}

interface CodexAccount {
  type?: string;
  email?: string | null;
  planType?: string;
}

interface ThreadResponse {
  thread?: { id?: string };
}

interface TurnResponse {
  turn?: { id?: string; status?: string };
}

interface TurnCompletedParams {
  threadId?: string;
  turn?: { id?: string; status?: string; error?: { message?: string } | null };
}

interface ThreadItem {
  type?: string;
  id?: string;
  text?: string;
  command?: string;
  changes?: Array<{ path?: string }>;
  summary?: string[];
  content?: string[];
  aggregatedOutput?: string;
}

function parseVersion(raw: string | null): { major: number; minor: number; patch: number } | null {
  const match = raw?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function isSupportedVersion(raw: string | null): boolean {
  const version = parseVersion(raw);
  return Boolean(version && version.major === 0 && version.minor === 146);
}

function modelInfo(model: CodexModel): ModelInfo | null {
  const id = model.id ?? model.model;
  if (!id || model.hidden) return null;
  const efforts = (model.supportedReasoningEfforts ?? [])
    .map((option) => option.reasoningEffort)
    .filter((effort): effort is string => Boolean(effort));
  return {
    id,
    label: model.displayName ?? id,
    efforts,
    defaultEffort: model.defaultReasoningEffort,
    deprecated: model.upgrade ? `superseded by ${model.upgrade}` : undefined,
  };
}

function describeItem(item: ThreadItem): AgentEvent | null {
  switch (item.type) {
    case 'agentMessage':
      return item.text ? { type: 'message', text: item.text } : null;
    case 'reasoning':
      return item.summary?.length || item.content?.length
        ? { type: 'reasoning', text: [...(item.summary ?? []), ...(item.content ?? [])].join('\n') }
        : null;
    case 'commandExecution':
      return { type: 'tool', name: 'shell', detail: item.command };
    case 'fileChange': {
      const paths = (item.changes ?? []).map((change) => change.path).filter(Boolean).join(', ');
      return { type: 'tool', name: 'edit', detail: paths || undefined };
    }
    case 'mcpToolCall':
      return { type: 'tool', name: 'mcp' };
    case 'webSearch':
      return { type: 'tool', name: 'search' };
    default:
      return null;
  }
}

class AppServerClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: Interface;
  private readonly pending = new Map<string | number, PendingRequest>();
  private nextId = 1;
  private closed = false;

  private constructor(private readonly stderrTail: { value: string }, child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', (line) => this.receive(line));
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail.value = `${stderrTail.value}${chunk.toString()}`.slice(-4000);
    });
    child.on('error', (error) => this.fail(error));
    child.on('close', (code, signal) => {
      if (!this.closed && code !== 0) this.fail(new Error(`Codex app-server exited (${code ?? signal ?? 'unknown'})`));
      else if (!this.closed) this.fail(new Error('Codex app-server closed before completing the request'));
    });
  }

  static async start(): Promise<AppServerClient> {
    const stderrTail = { value: '' };
    const child = spawn(CODEX_BIN, ['app-server', '--stdio'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const client = new AppServerClient(stderrTail, child);
    await client.request('initialize', {
      clientInfo: { name: 'mdve', title: 'MDVE', version: CLIENT_VERSION },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    client.notify('initialized');
    return client;
  }

  private receive(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let message: JsonRpcResponse & JsonRpcNotification;
    try {
      message = JSON.parse(trimmed) as JsonRpcResponse & JsonRpcNotification;
    } catch {
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'Codex app-server request failed'));
      else waiter.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      // MDVE deliberately runs with approvalPolicy=never and does not expose a
      // second tool-protocol surface. Reply explicitly so an unexpected server
      // request cannot leave a Conversation hanging forever.
      this.write({ id: message.id, error: { code: -32601, message: `MDVE does not implement ${message.method}` } });
    }
  }

  private fail(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  private write(message: unknown): void {
    if (!this.closed && !this.child.stdin.destroyed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex app-server is closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.write({ id, method, params });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.child.kill('SIGTERM');
    this.fail(new Error('Codex app-server closed'));
  }

  get diagnostics(): string {
    return this.stderrTail.value;
  }
}

export class CodexProvider implements Provider {
  id = 'codex';
  label = 'Codex (ChatGPT subscription)';

  private async installedVersion(): Promise<string | null> {
    try {
      const result = await execFileAsync(CODEX_BIN, ['--version'], { env: process.env });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async status(): Promise<{ ok: boolean; detail: string }> {
    const version = await this.installedVersion();
    if (!version) return { ok: false, detail: `\`${CODEX_BIN}\` was not found on PATH` };
    if (!isSupportedVersion(version)) return { ok: false, detail: `Codex ${version} is outside MDVE's tested range ${CODEX_COMPATIBILITY_RANGE}` };
    let client: AppServerClient | undefined;
    try {
      client = await AppServerClient.start();
      const result = await client.request<{ account?: CodexAccount | null; requiresOpenaiAuth?: boolean }>('account/read', {});
      if (!result.account) return { ok: false, detail: 'Codex is not logged in. Run `codex login`, then retry.' };
      if (result.account.type !== 'chatgpt') return { ok: false, detail: 'MDVE v1 requires a ChatGPT-authenticated Codex account.' };
      return { ok: true, detail: `${version} · ${result.account.email ?? 'ChatGPT account'}` };
    } catch {
      return { ok: false, detail: `Codex app-server is unavailable for ${version}` };
    } finally {
      client?.close();
    }
  }

  async catalog(): Promise<ModelCatalog> {
    const version = await this.installedVersion();
    if (!version || !isSupportedVersion(version)) return { models: [] };
    let client: AppServerClient | undefined;
    try {
      client = await AppServerClient.start();
      const result = await client.request<{ data?: CodexModel[] }>('model/list', {});
      const models = (result.data ?? []).map(modelInfo).filter((model): model is ModelInfo => Boolean(model));
      const defaultModel = (result.data ?? []).find((model) => model.isDefault)?.id;
      const defaultInfo = models.find((model) => model.id === defaultModel);
      return { models, defaultModel, defaultEffort: defaultInfo?.defaultEffort };
    } catch {
      return { models: [] };
    } finally {
      client?.close();
    }
  }

  async run(opts: RunOptions, emit: (event: AgentEvent) => void): Promise<void> {
    const client = await AppServerClient.start();
    let threadId = opts.threadId;
    let turnId: string | undefined;
    let interruptTimer: ReturnType<typeof setTimeout> | undefined;
    const interrupt = () => {
      if (!threadId || !turnId) {
        client.close();
        return;
      }
      void client.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      interruptTimer = setTimeout(() => client.close(), 2_000);
    };
    opts.signal.addEventListener('abort', interrupt, { once: true });

    try {
      if (threadId) {
        const result = await client.request<ThreadResponse>('thread/resume', {
          threadId,
          cwd: opts.workspace,
          sandbox: 'workspace-write',
          approvalPolicy: 'never',
        });
        threadId = result.thread?.id ?? threadId;
        emit({ type: 'thread', threadId });
      } else {
        const result = await client.request<ThreadResponse>('thread/start', {
          model: opts.model,
          cwd: opts.workspace,
          sandbox: 'workspace-write',
          approvalPolicy: 'never',
          threadSource: 'appServer',
        });
        threadId = result.thread?.id;
        if (!threadId) throw new Error('Codex app-server did not return a thread identity');
        emit({ type: 'thread', threadId });
      }

      const result = await client.request<TurnResponse>('turn/start', {
        threadId,
        input: [{ type: 'text', text: opts.prompt, text_elements: [] }],
        cwd: opts.workspace,
        model: opts.model,
        effort: opts.effort,
        approvalPolicy: 'never',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [opts.workspace],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      });
      turnId = result.turn?.id;
      emit({ type: 'status', text: 'thinking' });

      await new Promise<void>((resolve, reject) => {
        const onLine = (line: string) => {
          let message: JsonRpcNotification;
          try {
            message = JSON.parse(line) as JsonRpcNotification;
          } catch {
            return;
          }
          const params = (message.params ?? {}) as Record<string, unknown>;
          switch (message.method) {
            case 'thread/started': {
              const id = ((params.thread as { id?: string } | undefined)?.id);
              if (id) {
                threadId = id;
                emit({ type: 'thread', threadId: id });
              }
              break;
            }
            case 'turn/started':
              turnId = ((params.turn as { id?: string } | undefined)?.id) ?? turnId;
              emit({ type: 'status', text: 'thinking' });
              break;
            case 'item/agentMessage/delta':
              if (typeof params.delta === 'string') emit({ type: 'message', text: params.delta });
              break;
            case 'item/completed': {
              const mapped = describeItem((params.item ?? {}) as ThreadItem);
              if (mapped && mapped.type !== 'message') emit(mapped);
              break;
            }
            case 'turn/completed': {
              const turn = (params as TurnCompletedParams).turn;
              const status = turn?.status;
              if (status === 'failed') reject(new Error(turn?.error?.message ?? 'Codex turn failed'));
              else resolve();
              break;
            }
            case 'error': {
              const error = params as { message?: string };
              emit({ type: 'error', message: error.message ?? 'Codex app-server error' });
              break;
            }
            case 'warning':
              emit({ type: 'tool', name: 'warning', detail: typeof params.message === 'string' ? params.message : undefined });
              break;
            default:
              if (message.method) emit({ type: 'tool', name: `app-server:${message.method}` });
          }
        };
        const lineListener = (line: string) => onLine(line);
        client.lines.on('line', lineListener);
        client.child.once('error', reject);
        client.child.once('close', (code) => {
          if (code !== 0) reject(new Error(`Codex app-server exited before turn completion (${code ?? 'unknown'})`));
        });
      });
    } finally {
      opts.signal.removeEventListener('abort', interrupt);
      if (interruptTimer) clearTimeout(interruptTimer);
      client.close();
    }
  }
}
