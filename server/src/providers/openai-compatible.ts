import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DIAGRAM_FILE, ROOT } from '../sessions.js';
import type { AgentEvent, ModelCatalog, Provider, RunOptions } from './types.js';

const CONFIG_FILE = 'provider-openai-compatible.json';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DIAGRAM_START = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|timeline|mindmap|block-beta|C4Context)\b/i;

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAICompatibleConfigSummary {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

interface StoredConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

type MessageContent = string | Array<{ type?: string; text?: string }> | undefined;

function configPath(): string {
  return join(ROOT, CONFIG_FILE);
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isLocalBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  } catch {
    return false;
  }
}

function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function readStoredConfig(): Promise<StoredConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    return {
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : undefined,
      apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
      model: typeof record.model === 'string' ? record.model : undefined,
    };
  } catch {
    return {};
  }
}

async function resolvedConfig(): Promise<OpenAICompatibleConfig> {
  const stored = await readStoredConfig();
  return {
    baseUrl: cleanBaseUrl(process.env.MDVE_OPENAI_COMPATIBLE_BASE_URL?.trim() || stored.baseUrl || DEFAULT_BASE_URL),
    apiKey: process.env.MDVE_OPENAI_COMPATIBLE_API_KEY?.trim() || stored.apiKey || '',
    model: process.env.MDVE_OPENAI_COMPATIBLE_MODEL?.trim() || stored.model || '',
  };
}

export async function getOpenAICompatibleConfigSummary(): Promise<OpenAICompatibleConfigSummary> {
  const config = await resolvedConfig();
  return { baseUrl: config.baseUrl, model: config.model, hasApiKey: Boolean(config.apiKey) };
}

export async function saveOpenAICompatibleConfig(input: { baseUrl: string; model: string; apiKey?: string }): Promise<OpenAICompatibleConfigSummary> {
  const previous = await readStoredConfig();
  const baseUrl = cleanBaseUrl(input.baseUrl);
  const model = input.model.trim();
  if (!validBaseUrl(baseUrl)) throw new Error('BYOK base URL must be an http(s) URL.');
  if (!model) throw new Error('BYOK model is required.');
  const next: StoredConfig = {
    baseUrl,
    model,
    apiKey: input.apiKey === undefined ? previous.apiKey : input.apiKey.trim(),
  };
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  await writeFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(configPath(), 0o600);
  return { baseUrl, model, hasApiKey: Boolean(next.apiKey) };
}

export async function clearOpenAICompatibleConfig(): Promise<OpenAICompatibleConfigSummary> {
  try {
    await unlink(configPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return getOpenAICompatibleConfigSummary();
}

function contentText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text' || part?.type === undefined).map((part) => part?.text ?? '').join('');
}

/** Extract Mermaid source from the common fenced and plain-text LLM formats. */
export function extractMermaidSource(content: string): string | null {
  const fenced = content.match(/```(?:mermaid|mmd)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || content.trim();
  if (!candidate) return null;
  const lines = candidate.split(/\r?\n/);
  const start = lines.findIndex((line) => DIAGRAM_START.test(line.trim()));
  if (start < 0) return null;
  const source = lines.slice(start).join('\n').trim();
  return source || null;
}

export class OpenAICompatibleProvider implements Provider {
  id = 'openai-compatible';
  label = 'BYOK · OpenAI-compatible';

  async status(): Promise<{ ok: boolean; detail: string }> {
    const config = await resolvedConfig();
    if (!config.model) return { ok: false, detail: 'Configure a model to use your own AI key.' };
    if (!validBaseUrl(config.baseUrl)) return { ok: false, detail: 'BYOK base URL is not a valid http(s) URL.' };
    if (!config.apiKey && !isLocalBaseUrl(config.baseUrl)) return { ok: false, detail: 'Add an API key, or point BYOK at a local model server.' };
    return { ok: true, detail: `${config.model} · key stays on this device` };
  }

  async catalog(): Promise<ModelCatalog> {
    const config = await resolvedConfig();
    if (!config.model) return { models: [] };
    return {
      models: [{ id: config.model, label: config.model, efforts: [] }],
      defaultModel: config.model,
    };
  }

  async run(opts: RunOptions, emit: (event: AgentEvent) => void): Promise<void> {
    const config = await resolvedConfig();
    const status = await this.status();
    if (!status.ok) throw new Error(status.detail);
    const currentSource = await readFile(join(opts.workspace, DIAGRAM_FILE), 'utf8');
    emit({ type: 'status', text: `asking ${config.model}` });
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model || config.model,
        temperature: 0.15,
        messages: [
          {
            role: 'system',
            content: 'You edit Mermaid diagrams. Return the complete updated Mermaid source in one ```mermaid fenced block and nothing else. Preserve existing node IDs unless the user asks to change them. Keep the syntax renderable.',
          },
          {
            role: 'user',
            content: [
              'Current Mermaid source:',
              '',
              '```mermaid',
              currentSource,
              '```',
              '',
              'Requested change:',
              opts.prompt,
            ].join('\n'),
          },
        ],
        stream: false,
      }),
      signal: opts.signal,
    });
    let body: ChatCompletionResponse = {};
    try {
      body = await response.json() as ChatCompletionResponse;
    } catch {
      // The response text is intentionally not echoed because some providers
      // include request metadata in their errors.
    }
    if (!response.ok) throw new Error(body.error?.message || `BYOK provider returned HTTP ${response.status}`);
    const content = contentText(body.choices?.[0]?.message?.content);
    const source = extractMermaidSource(content);
    if (!source) throw new Error('BYOK provider did not return a complete Mermaid diagram.');
    await writeFile(join(opts.workspace, DIAGRAM_FILE), `${source}\n`, 'utf8');
    emit({ type: 'message', text: 'Prepared a Mermaid proposal from your configured BYOK provider.' });
    if (body.usage?.prompt_tokens !== undefined || body.usage?.completion_tokens !== undefined) {
      emit({ type: 'usage', input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 });
    }
  }
}
