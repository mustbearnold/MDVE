/**
 * MDVE backend: session storage, diagram file watching, and agent chat over SSE.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile as readFileAsync, rm } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import chokidar, { type FSWatcher } from 'chokidar';
import cors from 'cors';
import express from 'express';

import { CodexProvider } from './providers/codex.js';
import type { AgentEvent, Provider } from './providers/types.js';
import { PACKAGE_VERSION } from './version.js';
import {
  DEFAULT_DIAGRAM,
  AgentLeaseError,
  RevisionConflictError,
  UnsupportedDataSchemaError,
  appendTurnTrace,
  beginAgentTurn,
  createSession,
  createConversation,
  createRecoveryPoint,
  archiveConversation,
  restoreConversation,
  diagramPath,
  ensureAgentsFile,
  ensureRoot,
  finishAgentTurn,
  getDiagramState,
  listConversations,
  listSessions,
  readConversation,
  readDiagram,
  readHistory,
  readRecoveryPoint,
  readMeta,
  restoreRecoveryPoint,
  archiveSession,
  restoreSession,
  trashSession,
  permanentlyDeleteSession,
  latestOrCreate,
  sessionDir,
  sessionExists,
  updateMeta,
  updateConversation,
  writeDiagram,
  DIAGRAM_FILE,
  isSafeIdentifier,
} from './sessions.js';

const PORT = Number(process.env.MDVE_PORT ?? process.env.PORT ?? 8787);
const HOST = process.env.MDVE_HOST ?? process.env.HOST ?? '127.0.0.1';
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(
  process.env.MDVE_WEB_DIST ??
    (existsSync(resolve(__dirname, '../web')) ? resolve(__dirname, '../web') : resolve(__dirname, '../../web/dist')),
);
const VERSION = process.env.MDVE_VERSION ?? PACKAGE_VERSION;
const AUTH_REQUIRED = process.env.MDVE_AUTH_REQUIRED === '1';
const AUTH_HOST = `${HOST}:${PORT}`;
let bootstrapToken = process.env.MDVE_BOOTSTRAP_TOKEN ?? null;
const authSessions = new Set<string>();

const providers = new Map<string, Provider>();
const codex = new CodexProvider();
providers.set(codex.id, codex);

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json({ limit: '4mb' }));

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

function rejectInvalidLoopbackOrigin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!AUTH_REQUIRED) return next();
  if (req.get('host') !== AUTH_HOST) return void res.status(400).json({ error: `Invalid Host; use http://${AUTH_HOST}` });
  const origin = req.get('origin');
  if (origin && origin !== `http://${AUTH_HOST}`) {
    return void res.status(403).json({ error: 'Invalid Origin' });
  }
  next();
}

app.use(rejectInvalidLoopbackOrigin);

function sendError(res: express.Response, error: unknown, fallbackStatus = 500): express.Response {
  if (error instanceof UnsupportedDataSchemaError) {
    return res.status(409).json({
      error: error.message,
      schemaVersion: error.foundVersion,
      supportedSchemaVersion: error.supportedVersion,
    });
  }
  return res.status(fallbackStatus).json({ error: error instanceof Error ? error.message : String(error) });
}

app.param('id', (_req, res, next, value) => {
  if (!isSafeIdentifier(value)) return res.status(400).json({ error: 'Invalid Diagram identifier' });
  void readMeta(value).then(() => next()).catch((error: unknown) => {
    if (error instanceof UnsupportedDataSchemaError) return void sendError(res, error, 409);
    next(error);
  });
});

app.param('conversationId', (_req, res, next, value) => {
  if (!isSafeIdentifier(value)) return res.status(400).json({ error: 'Invalid Conversation identifier' });
  next();
});

app.get('/_mdve/ready', (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

app.get('/_auth/bootstrap', (req, res) => {
  if (!AUTH_REQUIRED) return res.redirect('/');
  const supplied = typeof req.query.token === 'string' ? req.query.token : '';
  if (!bootstrapToken || !sameSecret(supplied, bootstrapToken)) return res.status(401).send('Invalid or expired MDVE bootstrap link');
  bootstrapToken = null;
  const session = randomBytes(32).toString('hex');
  authSessions.add(session);
  res.setHeader('Set-Cookie', `mdve_session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
  res.redirect('/');
});

app.use('/api', (req, res, next) => {
  if (!AUTH_REQUIRED) return next();
  const session = cookieValue(req.get('cookie'), 'mdve_session');
  if (!session || !authSessions.has(session)) return res.status(401).json({ error: 'MDVE browser session is not authenticated' });
  next();
});

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

app.get('/api/sessions', async (req, res) => {
  const requestedScope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
  const scope = requestedScope === 'recent' || requestedScope === 'active' || requestedScope === 'archived' || requestedScope === 'trash' || requestedScope === 'all'
    ? requestedScope
    : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  try {
    res.json({ sessions: await listSessions(scope, search) });
  } catch (error) {
    sendError(res, error, 409);
  }
});

app.get('/api/startup', async (req, res) => {
  try {
    const selectedId = typeof req.query.selectedId === 'string' ? req.query.selectedId : undefined;
    const session = await latestOrCreate(selectedId);
    res.json({ session });
  } catch (error) {
    sendError(res, error, 409);
  }
});

app.get('/api/meta', async (_req, res) => {
  const provider = providers.get('codex');
  res.json({
    version: VERSION,
    serverVersion: VERSION,
    uiVersion: VERSION,
    node: process.versions.node,
    provider: provider ? { id: provider.id, status: await provider.status() } : null,
  });
});

app.post('/api/sessions', async (req, res) => {
  const { title, source } = req.body ?? {};
  if (title !== undefined && typeof title !== 'string') return res.status(400).json({ error: 'title must be a string' });
  if (source !== undefined && typeof source !== 'string') return res.status(400).json({ error: 'source must be a string' });
  const meta = await createSession({ title, source: source ?? DEFAULT_DIAGRAM });
  res.status(201).json({ session: meta });
});

app.get('/api/sessions/:id', async (req, res) => {
  const meta = await readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'No such session' });
  const state = await getDiagramState(req.params.id);
  if (!state) return res.status(409).json({ error: 'Diagram durability state is unavailable' });
  res.json({ session: { ...meta, revision: state.revision, checksum: state.checksum }, source: state.source, revision: state.revision, checksum: state.checksum, workspace: sessionDir(req.params.id) });
});

app.get('/api/sessions/:id/history', async (req, res) => {
  if (!(await sessionExists(req.params.id))) return res.status(404).json({ error: 'No such session' });
  res.json({ history: await readHistory(req.params.id) });
});

app.get('/api/sessions/:id/history/:pointId', async (req, res) => {
  const point = await readRecoveryPoint(req.params.id, req.params.pointId);
  if (!point) return res.status(404).json({ error: 'Recovery point is missing or damaged' });
  res.json(point);
});

app.post('/api/sessions/:id/history/:pointId/restore', async (req, res) => {
  try {
    const result = await restoreRecoveryPoint(req.params.id, req.params.pointId);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/sessions/:id/conversations', async (req, res) => {
  if (!(await sessionExists(req.params.id))) return res.status(404).json({ error: 'No such session' });
  res.json({ conversations: await listConversations(req.params.id) });
});

app.post('/api/sessions/:id/conversations', async (req, res) => {
  try {
    const conversation = await createConversation(req.params.id, { title: req.body?.title, provider: req.body?.provider ?? 'codex' });
    res.status(201).json({ conversation });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/sessions/:id/conversations/:conversationId', async (req, res) => {
  const conversation = await readConversation(req.params.id, req.params.conversationId);
  if (!conversation) return res.status(404).json({ error: 'No such conversation' });
  res.json({ conversation });
});

app.post('/api/sessions/:id/conversations/:conversationId/archive', async (req, res) => {
  try {
    const conversation = await archiveConversation(req.params.id, req.params.conversationId);
    if (!conversation) return res.status(404).json({ error: 'No such conversation' });
    res.json({ conversation });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/sessions/:id/conversations/:conversationId/restore', async (req, res) => {
  const conversation = await restoreConversation(req.params.id, req.params.conversationId);
  if (!conversation) return res.status(404).json({ error: 'No such conversation' });
  res.json({ conversation });
});

app.post('/api/sessions/:id/archive', async (req, res) => {
  try {
    const session = await archiveSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'No such session' });
    res.json({ session });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/sessions/:id/restore', async (req, res) => {
  try {
    const session = await restoreSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'No such session' });
    res.json({ session });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/sessions/:id/trash', async (req, res) => {
  try {
    const session = await trashSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'No such session' });
    res.json({ session });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const deleted = await permanentlyDeleteSession(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'No such session' });
    res.json({ ok: true });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/sessions/:id', async (req, res) => {
  const patch: { title?: string; selectedConversationId?: string } = {};
  if (req.body?.title !== undefined && typeof req.body.title !== 'string') {
    return res.status(400).json({ error: 'title must be a string' });
  }
  if (typeof req.body?.title === 'string') patch.title = req.body.title;
  if (typeof req.body?.selectedConversationId === 'string') {
    if (!(await readConversation(req.params.id, req.body.selectedConversationId))) {
      return res.status(400).json({ error: 'No such conversation' });
    }
    patch.selectedConversationId = req.body.selectedConversationId;
  }
  const meta = await updateMeta(req.params.id, patch);
  if (!meta) return res.status(404).json({ error: 'No such session' });
  res.json({ session: meta });
});

app.put('/api/sessions/:id/diagram', async (req, res) => {
  const { id } = req.params;
  const source = req.body?.source;
  if (typeof source !== 'string') return res.status(400).json({ error: 'source must be a string' });
  if (!(await sessionExists(id))) return res.status(404).json({ error: 'No such session' });
  try {
    const result = await writeDiagram(id, source, {
      expectedRevision: typeof req.body?.expectedRevision === 'number' ? req.body.expectedRevision : undefined,
      origin: req.body?.origin === 'import' ? 'import' : 'manual',
    });
    lastWrittenBySelf.set(id, source);
    let historyAvailable = true;
    try {
      await createRecoveryPoint(id, result.origin);
    } catch {
      historyAvailable = false;
    }
    res.json({ ok: true, ...result, historyAvailable });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return res.status(409).json({ error: error.message, expectedRevision: error.expectedRevision, revision: error.actualRevision, source: error.currentSource });
    }
    if (error instanceof AgentLeaseError) return res.status(423).json({ error: error.message, lease: error.lease });
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
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
  const { prompt, providerId = 'codex', model, effort, newThread, conversationId } = req.body ?? {};

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  const meta = await readMeta(id);
  if (!meta) return res.status(404).json({ error: 'No such session' });
  const provider = providers.get(providerId);
  if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerId}` });

  let conversation = conversationId ? await readConversation(id, conversationId) : undefined;
  if (conversation && conversation.provider !== providerId) {
    return res.status(409).json({ error: 'A Conversation is permanently bound to its original Agent provider; start a new Conversation to change provider.' });
  }
  if (!conversation || newThread) {
    conversation = await createConversation(id, { provider: providerId });
  }
  let turn;
  try {
    turn = await beginAgentTurn(id, conversation.id, {
      prompt,
      provider: providerId,
      providerThreadId: newThread ? undefined : conversation.providerThreadId,
      model,
      effort,
    });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }

  running.get(id)?.abort();
  const controller = new AbortController();
  running.set(id, controller);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let finalResponse = '';
  const emit = (event: AgentEvent) => {
    if (event.type === 'thread') {
      void updateMeta(id, { threadId: event.threadId, provider: providerId, model });
      void updateConversation(id, conversation!.id, { providerThreadId: event.threadId });
    }
    if (event.type === 'message') finalResponse += event.text;
    if (event.type === 'tool' || event.type === 'reasoning' || event.type === 'status') void appendTurnTrace(id, event.type === 'tool' ? `${event.name}${event.detail ? `: ${event.detail}` : ''}` : event.type === 'reasoning' ? event.text : event.text);
    send(res, 'agent', event);
  };

  req.on('close', () => controller.abort());

  try {
    await ensureAgentsFile(id);
    const agentWorkspace = await mkdtemp(join(tmpdir(), 'mdve-agent-'));
    let proposedSource: string | null = null;
    try {
      await copyFile(diagramPath(id), join(agentWorkspace, DIAGRAM_FILE));
      await copyFile(join(sessionDir(id), 'AGENTS.md'), join(agentWorkspace, 'AGENTS.md'));
      await provider.run(
        {
          prompt,
          workspace: agentWorkspace,
          threadId: newThread ? undefined : conversation.providerThreadId,
          model: model || undefined,
          effort: effort || undefined,
          signal: controller.signal,
        },
        emit,
      );
      proposedSource = await readFileAsync(join(agentWorkspace, DIAGRAM_FILE), 'utf8');
    } finally {
      await rm(agentWorkspace, { recursive: true, force: true });
    }

    const outcome = controller.signal.aborted ? 'interrupted' : 'completed';
    await finishAgentTurn(id, outcome, { finalResponse });
    const finalState = await getDiagramState(id);
    if (outcome === 'completed' && proposedSource !== null && finalState) {
      // The candidate was produced in an isolated workspace. It is not durable
      // until the user chooses Keep changes in the workbench.
      send(res, 'diagram', { source: proposedSource, revision: finalState.revision, proposal: true });
    } else if (finalState) {
      send(res, 'diagram', finalState);
    }
  } catch (err) {
    send(res, 'agent', { type: 'error', message: err instanceof Error ? err.message : String(err) });
    await finishAgentTurn(id, controller.signal.aborted ? 'interrupted' : 'failed', {
      finalResponse,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    const finalState = await getDiagramState(id).catch(() => null);
    if (finalState) send(res, 'diagram', finalState);
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

export { app };

if (process.env.MDVE_NO_LISTEN !== '1') {
  await ensureRoot();
  app.listen(PORT, HOST, () => {
    console.log(`MDVE server ready on http://${HOST}:${PORT} (version ${VERSION})`);
    if (!existsSync(WEB_DIST)) console.log('web/dist not built — run `npm run dev:web` for the UI');
  });
}
