/**
 * MDVE backend: session storage, diagram file watching, and agent chat over SSE.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import chokidar, { type FSWatcher } from 'chokidar';
import cors from 'cors';
import express from 'express';

import { CodexProvider } from './providers/codex.js';
import type { AgentEvent, Provider } from './providers/types.js';
import {
  DEFAULT_DIAGRAM,
  createSession,
  diagramPath,
  ensureAgentsFile,
  ensureRoot,
  listSessions,
  readDiagram,
  readMeta,
  sessionDir,
  sessionExists,
  snapshotDiagram,
  updateMeta,
  writeDiagram,
} from './sessions.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(__dirname, '../../web/dist');

const providers = new Map<string, Provider>();
const codex = new CodexProvider();
providers.set(codex.id, codex);

const app = express();
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json({ limit: '4mb' }));

/* ------------------------------------------------------------------ *
 * Live diagram updates
 * ------------------------------------------------------------------ */

type Client = { id: number; res: express.Response };
const watchers = new Map<string, { watcher: FSWatcher; clients: Set<Client> }>();
/** Text last written by the editor, so we can ignore our own file events. */
const lastWrittenBySelf = new Map<string, string>();
let clientSeq = 0;

function send(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function ensureWatcher(sessionId: string): Promise<{ watcher: FSWatcher; clients: Set<Client> }> {
  const existing = watchers.get(sessionId);
  if (existing) return existing;

  const watcher = chokidar.watch(diagramPath(sessionId), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });
  const entry = { watcher, clients: new Set<Client>() };

  const push = async () => {
    const source = await readDiagram(sessionId);
    if (source === null) return;
    if (lastWrittenBySelf.get(sessionId) === source) return;
    lastWrittenBySelf.set(sessionId, source);
    for (const client of entry.clients) send(client.res, 'diagram', { source });
  };

  watcher.on('change', push);
  watcher.on('add', push);
  watchers.set(sessionId, entry);
  return entry;
}

app.get('/api/sessions/:id/events', async (req, res) => {
  const { id } = req.params;
  if (!(await sessionExists(id))) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const entry = await ensureWatcher(id);
  const client: Client = { id: ++clientSeq, res };
  entry.clients.add(client);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    entry.clients.delete(client);
    if (entry.clients.size === 0) {
      entry.watcher.close();
      watchers.delete(id);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Sessions + diagrams
 * ------------------------------------------------------------------ */

app.get('/api/sessions', async (_req, res) => {
  res.json({ sessions: await listSessions() });
});

app.post('/api/sessions', async (req, res) => {
  const { title, source } = req.body ?? {};
  const meta = await createSession({ title, source: source ?? DEFAULT_DIAGRAM });
  res.json({ session: meta });
});

app.get('/api/sessions/:id', async (req, res) => {
  const meta = await readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'No such session' });
  const source = (await readDiagram(req.params.id)) ?? '';
  res.json({ session: meta, source, workspace: sessionDir(req.params.id) });
});

app.patch('/api/sessions/:id', async (req, res) => {
  const meta = await updateMeta(req.params.id, { title: req.body?.title });
  if (!meta) return res.status(404).json({ error: 'No such session' });
  res.json({ session: meta });
});

app.put('/api/sessions/:id/diagram', async (req, res) => {
  const { id } = req.params;
  const source = req.body?.source;
  if (typeof source !== 'string') return res.status(400).json({ error: 'source must be a string' });
  if (!(await sessionExists(id))) return res.status(404).json({ error: 'No such session' });
  lastWrittenBySelf.set(id, source);
  await writeDiagram(id, source);
  await updateMeta(id, {});
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Providers + chat
 * ------------------------------------------------------------------ */

app.get('/api/providers', async (_req, res) => {
  const out = [];
  for (const provider of providers.values()) {
    const [status, catalog] = await Promise.all([provider.status(), provider.catalog()]);
    out.push({ id: provider.id, label: provider.label, status, ...catalog });
  }
  res.json({ providers: out });
});

const running = new Map<string, AbortController>();

app.post('/api/sessions/:id/chat', async (req, res) => {
  const { id } = req.params;
  const { prompt, providerId = 'codex', model, effort, newThread } = req.body ?? {};

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  const meta = await readMeta(id);
  if (!meta) return res.status(404).json({ error: 'No such session' });
  const provider = providers.get(providerId);
  if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerId}` });

  running.get(id)?.abort();
  const controller = new AbortController();
  running.set(id, controller);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const emit = (event: AgentEvent) => {
    if (event.type === 'thread') void updateMeta(id, { threadId: event.threadId, provider: providerId, model });
    send(res, 'agent', event);
  };

  req.on('close', () => controller.abort());

  try {
    await ensureAgentsFile(id);
    await snapshotDiagram(id);
    await provider.run(
      {
        prompt,
        workspace: sessionDir(id),
        threadId: newThread ? undefined : meta.threadId,
        model: model || undefined,
        effort: effort || undefined,
        signal: controller.signal,
      },
      emit,
    );
    // The agent edits the file directly; hand back the final text so the client
    // does not have to race the watcher.
    const source = await readDiagram(id);
    if (source !== null) send(res, 'diagram', { source });
  } catch (err) {
    send(res, 'agent', { type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    running.delete(id);
    send(res, 'agent', { type: 'done' });
    res.end();
  }
});

app.post('/api/sessions/:id/stop', (req, res) => {
  running.get(req.params.id)?.abort();
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Static build (production)
 * ------------------------------------------------------------------ */

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
}

await ensureRoot();
app.listen(PORT, HOST, () => {
  console.log(`MDVE server on http://${HOST}:${PORT}`);
  if (!existsSync(WEB_DIST)) console.log('web/dist not built — run `npm run dev:web` for the UI');
});
