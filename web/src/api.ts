export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  threadId?: string;
  provider?: string;
  model?: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  models: string[];
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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  listSessions: () => req<{ sessions: SessionMeta[] }>('/api/sessions'),

  createSession: (title?: string) =>
    req<{ session: SessionMeta }>('/api/sessions', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ title }),
    }),

  getSession: (id: string) =>
    req<{ session: SessionMeta; source: string; workspace: string }>(`/api/sessions/${id}`),

  renameSession: (id: string, title: string) =>
    req<{ session: SessionMeta }>(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ title }),
    }),

  saveDiagram: (id: string, source: string) =>
    req<{ ok: true }>(`/api/sessions/${id}/diagram`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ source }),
    }),

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
  body: { prompt: string; providerId: string; model?: string; newThread?: boolean },
  handlers: { onAgent: (e: AgentEvent) => void; onDiagram: (source: string) => void },
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
    else if (event === 'diagram') handlers.onDiagram((data as { source: string }).source);
  }
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
