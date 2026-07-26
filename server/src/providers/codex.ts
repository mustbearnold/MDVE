/**
 * Codex CLI provider.
 *
 * Uses the locally installed, already-authenticated `codex` binary, so the
 * user's ChatGPT subscription is the credential — MDVE never touches tokens.
 * The agent edits the diagram by editing `diagram.mmd` inside the session
 * workspace with its own file tools; the server watches that file.
 */

import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type { AgentEvent, ModelCatalog, ModelInfo, Provider, RunOptions } from './types.js';

const CODEX_BIN = process.env.MDVE_CODEX_BIN ?? 'codex';
const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex');

/**
 * User config is skipped by default: it pulls in the user's MCP servers,
 * skills and hooks, which slow every turn down and are irrelevant here.
 * Authentication still comes from CODEX_HOME/auth.json either way. Because the
 * config is skipped, the model and reasoning effort it declares are read
 * separately (see readConfigDefaults) and passed on the command line, so MDVE
 * still honours the user's chosen model.
 */
const IGNORE_USER_CONFIG = process.env.MDVE_CODEX_USER_CONFIG !== '1';

/** Used only when Codex has never written its model cache. */
const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', efforts: ['low', 'medium', 'high', 'xhigh'] },
];

interface CachedModel {
  slug?: string;
  display_name?: string;
  visibility?: string;
  priority?: number;
  context_window?: number;
  default_reasoning_level?: string;
  supported_reasoning_levels?: { effort?: string }[];
  upgrade?: { model?: string } | null;
}

/**
 * Codex refreshes `models_cache.json` from the account's entitlements, so it is
 * the only accurate source for which models this subscription can actually use.
 */
async function readModelCache(): Promise<ModelInfo[]> {
  try {
    const raw = JSON.parse(await readFile(join(CODEX_HOME, 'models_cache.json'), 'utf8')) as {
      models?: CachedModel[];
    };
    const models = (raw.models ?? [])
      .filter((m) => m.slug && m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map<ModelInfo>((m) => ({
        id: m.slug!,
        label: m.display_name ?? m.slug!,
        efforts: (m.supported_reasoning_levels ?? [])
          .map((l) => l.effort)
          .filter((e): e is string => Boolean(e)),
        defaultEffort: m.default_reasoning_level,
        deprecated: m.upgrade?.model ? `superseded by ${m.upgrade.model}` : undefined,
        contextWindow: m.context_window,
      }));
    return models.length > 0 ? models : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

/**
 * Minimal reader for the two top-level keys MDVE cares about. Only lines before
 * the first `[table]` header are top level, which is all we want — profile and
 * project overrides are out of scope here.
 */
async function readConfigDefaults(): Promise<{ model?: string; effort?: string }> {
  try {
    const text = await readFile(join(CODEX_HOME, 'config.toml'), 'utf8');
    const out: { model?: string; effort?: string } = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) break;
      const m = /^model\s*=\s*"([^"]+)"/.exec(trimmed);
      if (m) out.model = m[1];
      const e = /^model_reasoning_effort\s*=\s*"([^"]+)"/.exec(trimmed);
      if (e) out.effort = e[1];
    }
    return out;
  } catch {
    return {};
  }
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  message?: string;
  command?: string;
  aggregated_output?: string;
  path?: string;
  changes?: unknown;
  query?: string;
  [key: string]: unknown;
}

function describeItem(item: CodexItem): AgentEvent | null {
  switch (item.type) {
    case 'agent_message':
      return item.text ? { type: 'message', text: item.text } : null;
    case 'reasoning':
      return item.text ? { type: 'reasoning', text: item.text } : null;
    case 'command_execution':
      return { type: 'tool', name: 'shell', detail: item.command };
    case 'file_change': {
      const changes = item.changes;
      const paths = Array.isArray(changes)
        ? changes
            .map((c) => (c && typeof c === 'object' ? (c as { path?: string }).path : undefined))
            .filter(Boolean)
            .join(', ')
        : item.path;
      return { type: 'tool', name: 'edit', detail: paths ?? undefined };
    }
    case 'mcp_tool_call':
      return { type: 'tool', name: 'mcp', detail: String(item.tool ?? '') };
    case 'web_search':
      return { type: 'tool', name: 'search', detail: item.query };
    case 'error':
      // Item-level errors are usually advisories (context budget notices, tool
      // hiccups the agent recovers from). Real failures arrive as turn.failed
      // or a non-zero exit, so keep these in the trace instead of the message.
      return { type: 'tool', name: 'notice', detail: item.message ?? 'unknown Codex error' };
    default:
      return null;
  }
}

export class CodexProvider implements Provider {
  id = 'codex';
  label = 'Codex (ChatGPT subscription)';

  async catalog(): Promise<ModelCatalog> {
    const [models, config] = await Promise.all([readModelCache(), readConfigDefaults()]);
    const defaultModel = models.some((m) => m.id === config.model) ? config.model : models[0]?.id;
    return {
      models,
      defaultModel,
      defaultEffort: config.effort ?? models.find((m) => m.id === defaultModel)?.defaultEffort,
    };
  }

  async status(): Promise<{ ok: boolean; detail: string }> {
    try {
      await access(join(CODEX_HOME, 'auth.json'));
    } catch {
      return { ok: false, detail: `Not logged in. Run: ${CODEX_BIN} login` };
    }

    const version = await new Promise<string | null>((resolve) => {
      const child = spawn(CODEX_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('error', () => resolve(null));
      child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    });

    if (!version) return { ok: false, detail: `\`${CODEX_BIN}\` not found on PATH` };
    return { ok: true, detail: version };
  }

  async run(opts: RunOptions, emit: (event: AgentEvent) => void): Promise<void> {
    const args: string[] = ['exec'];
    if (opts.threadId) {
      // `resume` inherits sandbox policy and cwd from the recorded session, and
      // rejects -s / -C outright.
      args.push('resume', opts.threadId);
    } else {
      args.push('-s', 'workspace-write', '-C', opts.workspace);
    }
    args.push('--json', '--skip-git-repo-check');
    if (IGNORE_USER_CONFIG) args.push('--ignore-user-config');

    // With user config ignored, nothing else supplies the model or effort, so
    // fall back to what config.toml declares rather than Codex's built-in default.
    const defaults = await this.catalog();
    const model = opts.model || defaults.defaultModel;
    const effort = opts.effort || defaults.defaultEffort;
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    args.push('-');

    const child = spawn(CODEX_BIN, args, {
      cwd: opts.workspace,
      env: { ...process.env, CODEX_HOME },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const kill = () => child.kill('SIGTERM');
    opts.signal.addEventListener('abort', kill, { once: true });

    child.stdin.end(opts.prompt);

    let stderrTail = '';
    child.stderr.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    const rl = createInterface({ input: child.stdout });
    let sawMessage = false;

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }

      switch (event.type) {
        case 'thread.started':
          if (typeof event.thread_id === 'string') emit({ type: 'thread', threadId: event.thread_id });
          break;
        case 'turn.started':
          emit({ type: 'status', text: 'thinking' });
          break;
        case 'item.completed': {
          const mapped = describeItem((event.item ?? {}) as CodexItem);
          if (mapped) {
            if (mapped.type === 'message') sawMessage = true;
            emit(mapped);
          }
          break;
        }
        case 'turn.completed': {
          const usage = event.usage as
            | { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number }
            | undefined;
          if (usage) {
            emit({
              type: 'usage',
              input: usage.input_tokens ?? 0,
              output: usage.output_tokens ?? 0,
              cached: usage.cached_input_tokens,
            });
          }
          break;
        }
        case 'turn.failed':
          emit({
            type: 'error',
            message:
              (event.error as { message?: string } | undefined)?.message ?? 'Codex turn failed',
          });
          break;
      }
    });

    await new Promise<void>((resolve) => {
      child.on('error', (err) => {
        emit({ type: 'error', message: `Failed to start ${CODEX_BIN}: ${err.message}` });
        resolve();
      });
      child.on('close', (code) => {
        opts.signal.removeEventListener('abort', kill);
        if (code !== 0 && !opts.signal.aborted) {
          const detail = stderrTail.split('\n').filter(Boolean).slice(-3).join('\n');
          emit({ type: 'error', message: `codex exited with code ${code}\n${detail}` });
        } else if (code === 0 && !sawMessage) {
          emit({ type: 'status', text: 'turn finished with no message' });
        }
        resolve();
      });
    });
  }
}

/** Reads the raw last-message file if a caller needs it outside the stream. */
export async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
