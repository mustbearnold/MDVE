export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt?: number;
  schemaVersion?: number;
  revision?: number;
  checksum?: string;
  archived?: boolean;
  trashed?: boolean;
  trashedAt?: number;
  lastLifecycleAction?: { action: 'new' | 'archive' | 'restore' | 'trash' | 'permanent-delete'; origin: 'user' | 'agent' | 'system'; at: number };
  sourceSummary?: string;
  historyDegraded?: boolean;
  selectedConversationId?: string;
  agentLease?: { turnId: string; conversationId: string; startedAt: number };
  threadId?: string;
  provider?: string;
  model?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort?: string;
  deprecated?: string;
  contextWindow?: number;
}

export interface ProviderInfo {
  id: string;
  label: string;
  models: ModelInfo[];
  defaultModel?: string;
  defaultEffort?: string;
  status: { ok: boolean; detail: string };
}

export type AgentEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'status'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'message'; text: string }
  | { type: 'usage'; input: number; output: number; cached?: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

const json = { 'Content-Type': 'application/json' };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.text();
  if (!res.ok) {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = undefined;
    }
    const detail = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' ? payload.error : body;
    throw new ApiError(`${res.status} ${detail}`, res.status, payload);
  }
  return JSON.parse(body) as T;
}

export const api = {
  listSessions: (scope: 'recent' | 'active' | 'archived' | 'all' | 'trash' = 'all', search = '') => {
    const params = new URLSearchParams();
    if (scope !== 'all') params.set('scope', scope);
    if (search) params.set('search', search);
    const query = params.toString();
    return req<{ sessions: SessionMeta[] }>(`/api/sessions${query ? `?${query}` : ''}`);
  },

  startup: (selectedId?: string) => {
    const query = selectedId ? `?selectedId=${encodeURIComponent(selectedId)}` : '';
    return req<{ session: SessionMeta }>(`/api/startup${query}`);
  },

  createSession: (title?: string) =>
    req<{ session: SessionMeta }>('/api/sessions', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ title }),
    }),

  getSession: (id: string) =>
    req<{ session: SessionMeta; source: string; revision: number; checksum: string; workspace: string }>(`/api/sessions/${id}`),

  renameSession: (id: string, title: string) =>
    req<{ session: SessionMeta }>(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ title }),
    }),

  selectConversation: (id: string, conversationId: string) =>
    req<{ session: SessionMeta }>(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ selectedConversationId: conversationId }),
    }),

  saveDiagram: (id: string, source: string, expectedRevision?: number, origin: 'manual' | 'import' = 'manual') =>
    req<{ ok: true; revision: number; checksum: string; historyAvailable: boolean }>(`/api/sessions/${id}/diagram`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ source, expectedRevision, origin }),
    }),

  history: (id: string) => req<{ history: RecoveryPoint[] }>(`/api/sessions/${id}/history`),

  restoreHistory: (id: string, pointId: string) =>
    req<{ ok: true; revision: number; checksum: string }>(`/api/sessions/${id}/history/${pointId}/restore`, { method: 'POST' }),

  historyPoint: (id: string, pointId: string) =>
    req<{ point: RecoveryPoint; source: string }>(`/api/sessions/${id}/history/${pointId}`),

  conversations: (id: string) => req<{ conversations: ConversationRecord[] }>(`/api/sessions/${id}/conversations`),

  createConversation: (id: string, title?: string, provider = 'codex') =>
    req<{ conversation: ConversationRecord }>(`/api/sessions/${id}/conversations`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ title, provider }),
    }),

  archiveConversation: (id: string, conversationId: string) =>
    req<{ conversation: ConversationRecord }>(`/api/sessions/${id}/conversations/${conversationId}/archive`, { method: 'POST' }),

  restoreConversation: (id: string, conversationId: string) =>
    req<{ conversation: ConversationRecord }>(`/api/sessions/${id}/conversations/${conversationId}/restore`, { method: 'POST' }),

  archiveSession: (id: string) =>
    req<{ session: SessionMeta }>(`/api/sessions/${id}/archive`, { method: 'POST' }),

  restoreSession: (id: string) =>
    req<{ session: SessionMeta }>(`/api/sessions/${id}/restore`, { method: 'POST' }),

  trashSession: (id: string) =>
    req<{ session: SessionMeta }>(`/api/sessions/${id}/trash`, { method: 'POST' }),

  permanentlyDeleteSession: (id: string) =>
    req<{ ok: true }>(`/api/sessions/${id}`, { method: 'DELETE' }),

  providers: () => req<{ providers: ProviderInfo[] }>('/api/providers'),

  stop: (id: string) => req<{ ok: true }>(`/api/sessions/${id}/stop`, { method: 'POST' }),
};

/** Parses an SSE byte stream into (event, data) pairs. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      try {
        yield { event, data: JSON.parse(dataLines.join('\n')) };
      } catch {
        /* ignore malformed frames */
      }
    }
  }
}

export async function streamChat(
  sessionId: string,
  body: { prompt: string; providerId: string; model?: string; effort?: string; newThread?: boolean; conversationId?: string },
  handlers: { onAgent: (e: AgentEvent) => void; onDiagram: (source: string, state?: { revision?: number; checksum?: string }) => void },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Chat failed: ${res.status} ${await res.text()}`);

  for await (const { event, data } of sse(res.body)) {
    if (event === 'agent') handlers.onAgent(data as AgentEvent);
    else if (event === 'diagram') {
      const diagram = data as { source: string; revision?: number; checksum?: string };
      handlers.onDiagram(diagram.source, diagram);
    }
  }
}

export interface RecoveryPoint {
  id: string;
  revision: number;
  checksum: string;
  createdAt: number;
  origin: 'manual' | 'import' | 'agent' | 'restore' | 'system';
  file: string;
  turnId?: string;
  outcome?: 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  createdAt: number;
  trace?: string[];
  error?: boolean;
}

export interface ConversationRecord {
  id: string;
  title: string;
  provider: string;
  providerThreadId?: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  status: 'ready' | 'running' | 'stopped' | 'failed' | 'interrupted' | 'cannot-resume';
  startingRevision: number;
  lastRevision: number;
  messages: ConversationMessage[];
}

/** Live diagram changes made outside the editor (agent edits, external tools). */
export function subscribeDiagram(sessionId: string, onDiagram: (source: string) => void): () => void {
  const es = new EventSource(`/api/sessions/${sessionId}/events`);
  es.addEventListener('diagram', (ev) => {
    try {
      onDiagram((JSON.parse((ev as MessageEvent).data) as { source: string }).source);
    } catch {
      /* ignore */
    }
  });
  return () => es.close();
}
