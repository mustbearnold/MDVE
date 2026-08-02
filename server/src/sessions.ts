/**
 * Durable Diagram workspaces.
 *
 * `diagram.mmd` remains the canonical source. `revision.json`, the recovery
 * ledger, Conversations, and turn records are durable evidence around that
 * source; none of them is a second diagram model.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const DATA_SCHEMA_VERSION = 1;
export const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_RECOVERY_POINTS = 100;
export let ROOT = process.env.MDVE_HOME ?? join(homedir(), '.mdve');
export let SESSIONS_DIR = join(ROOT, 'sessions');
export const DIAGRAM_FILE = 'diagram.mmd';

export const DEFAULT_DIAGRAM = `flowchart TD
  start([Start]) --> collect[Collect requirements]
  collect --> decide{Scope clear?}
  decide -->|yes| build[Build it]
  decide -->|no| collect
  build --> ship([Ship])
`;

/** Test harness hook; normal application code uses the process environment. */
export function setDataRoot(root: string): void {
  ROOT = root;
  SESSIONS_DIR = join(root, 'sessions');
}

const AGENTS_MD = `# MDVE Diagram workspace

This directory belongs to MDVE, a Mermaid diagram editor. The user is reviewing
a candidate rendering of \`${DIAGRAM_FILE}\` while you work.

Rules:

- \`${DIAGRAM_FILE}\` is the diagram candidate for this turn. To propose a change,
  edit that file; MDVE will show the result for review before it becomes a durable
  revision.
- Always read \`${DIAGRAM_FILE}\` before editing it; the user may have changed it
  since your last turn.
- Keep the file valid Mermaid. If you are unsure a construct renders, prefer the
  plain flowchart syntax.
- Never use a Mermaid keyword as a node id: \`call\`, \`end\`, \`class\`, \`classDef\`,
  \`click\`, \`callback\`, \`href\`, \`style\`, \`linkStyle\`, \`graph\`, \`flowchart\`,
  \`subgraph\`, \`direction\`, \`default\`, \`interpolate\`. Prefix or rephrase it.
- Preserve existing node ids unless asked to rename them; the editor tracks
  selection by id.
- \`${DIAGRAM_FILE}\` must contain a diagram and nothing else. Never park research
  notes, prose or citations in it.
- Reply with a one or two sentence summary of what you changed. Do not paste the
  whole diagram back; the user can already see the proposal.
`;

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}

function safeIdentifier(value: string): string {
  if (!isSafeIdentifier(value)) throw new Error('Invalid MDVE identifier');
  return value;
}

function safePath(root: string, child: string): string {
  const normalizedRoot = resolve(root);
  const candidate = resolve(normalizedRoot, child);
  if (!candidate.startsWith(`${normalizedRoot}${sep}`)) throw new Error('Invalid MDVE path');
  return candidate;
}

export type RevisionOrigin = 'manual' | 'import' | 'agent' | 'restore' | 'system';
export type AgentTurnStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';
export type LifecycleOrigin = 'user' | 'agent' | 'system';
export type LifecycleAction = 'new' | 'archive' | 'restore' | 'trash' | 'permanent-delete';

export interface LifecycleRecord {
  action: LifecycleAction;
  origin: LifecycleOrigin;
  at: number;
}

export interface AgentLease {
  turnId: string;
  conversationId: string;
  startedAt: number;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  schemaVersion: number;
  revision: number;
  checksum: string;
  archived?: boolean;
  trashed?: boolean;
  trashedAt?: number;
  lastLifecycleAction?: LifecycleRecord;
  /** Derived for library rows; it is intentionally not persisted in session.json. */
  sourceSummary?: string;
  historyDegraded?: boolean;
  selectedConversationId?: string;
  agentLease?: AgentLease;
  /** Compatibility fields retained while older workspaces migrate. */
  threadId?: string;
  provider?: string;
  model?: string;
}

export interface RevisionRecord {
  revision: number;
  checksum: string;
  updatedAt: number;
  origin: RevisionOrigin;
  turnId?: string;
}

export interface RecoveryPoint {
  id: string;
  revision: number;
  checksum: string;
  createdAt: number;
  origin: RevisionOrigin;
  file: string;
  turnId?: string;
  outcome?: AgentTurnStatus;
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

export interface AgentTurnRecord {
  id: string;
  conversationId: string;
  provider: string;
  providerThreadId?: string;
  model?: string;
  effort?: string;
  prompt: string;
  status: AgentTurnStatus;
  startedAt: number;
  endedAt?: number;
  startingRevision: number;
  endingRevision?: number;
  preRecoveryPointId: string;
  postRecoveryPointId?: string;
  finalResponse?: string;
  error?: string;
  trace: string[];
}

export interface DiagramState {
  revision: number;
  checksum: string;
  source: string;
}

export interface SaveResult {
  revision: number;
  checksum: string;
  origin: RevisionOrigin;
}

export class RevisionConflictError extends Error {
  name = 'RevisionConflictError';

  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
    public readonly currentSource: string,
  ) {
    super(`Diagram changed before this save (expected revision ${expectedRevision}, current revision ${actualRevision})`);
  }
}

export class AgentLeaseError extends Error {
  name = 'AgentLeaseError';
  constructor(public readonly lease: AgentLease) {
    super(`Diagram is locked by agent turn ${lease.turnId}`);
  }
}

export class UnsupportedDataSchemaError extends Error {
  name = 'UnsupportedDataSchemaError';

  constructor(public readonly foundVersion: number, public readonly supportedVersion = DATA_SCHEMA_VERSION) {
    super(
      `MDVE data schema version ${foundVersion} is newer than supported version ${supportedVersion}; refusing to write this workspace. Upgrade MDVE before continuing.`,
    );
  }
}

type DurabilityFaultPoint =
  | 'temporary-create'
  | 'partial-write'
  | 'file-sync'
  | 'close'
  | 'rename'
  | 'after-rename'
  | 'directory-sync'
  | 'cleanup';

let faultInjector: ((point: DurabilityFaultPoint, targetPath?: string) => void) | undefined;

/** Test-only hook used by the fault-injection suite; production leaves it unset. */
export function setDurabilityFaultInjector(injector?: (point: DurabilityFaultPoint, targetPath?: string) => void): void {
  faultInjector = injector;
}

function fault(point: DurabilityFaultPoint, targetPath?: string): void {
  faultInjector?.(point, targetPath);
  const requested = process.env.MDVE_DURABILITY_CRASH;
  if (requested === point || (targetPath && requested === `${point}:${basename(targetPath)}`)) {
    // Test-only subprocess hook. SIGKILL deliberately skips the write cleanup
    // path so restart recovery proves what a process crash actually leaves on disk.
    process.kill(process.pid, 'SIGKILL');
  }
}

function metaPath(id: string): string {
  return safePath(sessionDir(id), 'session.json');
}

function revisionPath(id: string): string {
  return safePath(sessionDir(id), 'revision.json');
}

function historyDir(id: string): string {
  return safePath(sessionDir(id), 'history');
}

function historyManifestPath(id: string): string {
  return safePath(historyDir(id), 'index.json');
}

function conversationsDir(id: string): string {
  return safePath(sessionDir(id), 'conversations');
}

function conversationPath(sessionId: string, conversationId: string): string {
  return safePath(conversationsDir(sessionId), `${safeIdentifier(conversationId)}.json`);
}

function turnPath(id: string): string {
  return safePath(sessionDir(id), 'turn.json');
}

export function sessionDir(id: string): string {
  return safePath(SESSIONS_DIR, safeIdentifier(id));
}

export function diagramPath(id: string): string {
  return safePath(sessionDir(id), DIAGRAM_FILE);
}

function checksum(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

function normalizeMeta(input: Partial<SessionMeta> & Pick<SessionMeta, 'id' | 'title' | 'createdAt' | 'updatedAt'>): SessionMeta {
  return {
    ...input,
    id: input.id,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastActivityAt: input.lastActivityAt ?? input.updatedAt,
    schemaVersion: input.schemaVersion ?? DATA_SCHEMA_VERSION,
    revision: input.revision ?? 0,
    checksum: input.checksum ?? '',
  };
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    fault('temporary-create', path);
    const temporaryFile = await open(temporaryPath, 'wx');
    try {
      fault('partial-write', path);
      await temporaryFile.writeFile(content, 'utf8');
      fault('file-sync', path);
      await temporaryFile.sync();
    } finally {
      try {
        fault('close', path);
      } finally {
        await temporaryFile.close();
      }
    }

    fault('rename', path);
    await rename(temporaryPath, path);
    renamed = true;
    fault('after-rename', path);

    const parentDirectory = await open(dirname(path), 'r');
    try {
      fault('directory-sync', path);
      await parentDirectory.sync();
    } finally {
      await parentDirectory.close();
    }
  } catch (error) {
    if (!renamed) {
      try {
        fault('cleanup', path);
        await unlink(temporaryPath);
      } catch {
        /* A failed cleanup is diagnosable on restart; never mask the write error. */
      }
    }
    throw error;
  }
}

async function removeAbandonedTemporaryFiles(root: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    const path = safePath(root, entry.name);
    if (entry.isDirectory()) {
      removed += await removeAbandonedTemporaryFiles(path);
    } else if (entry.isFile() && entry.name.endsWith('.tmp')) {
      await unlink(path).then(() => { removed += 1; }).catch(() => undefined);
    }
  }
  return removed;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeMeta(meta: SessionMeta): Promise<void> {
  await writeAtomic(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

export async function readMeta(id: string): Promise<SessionMeta | null> {
  const parsed = await readJson<SessionMeta>(metaPath(id));
  if (!parsed || typeof parsed.id !== 'string' || typeof parsed.title !== 'string') return null;
  const meta = normalizeMeta(parsed as Pick<SessionMeta, 'id' | 'title' | 'createdAt' | 'updatedAt'> & Partial<SessionMeta>);
  if (meta.schemaVersion > DATA_SCHEMA_VERSION) throw new UnsupportedDataSchemaError(meta.schemaVersion);
  return meta;
}

async function readRevision(id: string): Promise<RevisionRecord | null> {
  return readJson<RevisionRecord>(revisionPath(id));
}

async function writeRevision(id: string, revision: RevisionRecord): Promise<void> {
  await writeAtomic(revisionPath(id), JSON.stringify(revision, null, 2));
}

export async function readDiagram(id: string): Promise<string | null> {
  try {
    return await readFile(diagramPath(id), 'utf8');
  } catch {
    return null;
  }
}

async function writeRecoveryPointFile(
  id: string,
  source: string,
  revision: number,
  origin: RevisionOrigin,
  turnId?: string,
  outcome?: AgentTurnStatus,
): Promise<RecoveryPoint> {
  await mkdir(historyDir(id), { recursive: true });
  const digest = checksum(source);
  const existing = await readHistory(id);
  const lifecyclePoint = origin === 'restore' || Boolean(turnId) || Boolean(outcome);
  const duplicate = lifecyclePoint ? undefined : existing.find((point) => point.checksum === digest);
  if (duplicate) return duplicate;

  const idValue = randomUUID();
  const file = `${String(revision).padStart(10, '0')}-${digest.slice(0, 16)}.mmd`;
  const point: RecoveryPoint = {
    id: idValue,
    revision,
    checksum: digest,
    createdAt: Date.now(),
    origin,
    file,
    turnId,
    outcome,
  };
  await writeAtomic(safePath(historyDir(id), file), source);
  const now = Date.now();
  const cutoff = now - RECOVERY_RETENTION_MS;
  const candidates = [...existing, point];
  const keep = new Set(
    candidates
      .map((candidate, index) => ({ candidate, index }))
      .sort(
        (left, right) =>
          right.candidate.createdAt - left.candidate.createdAt ||
          right.candidate.revision - left.candidate.revision ||
          right.index - left.index,
      )
      .slice(0, MIN_RECOVERY_POINTS)
      .map(({ candidate }) => candidate.id),
  );
  for (const candidate of candidates) {
    if (candidate.createdAt >= cutoff) keep.add(candidate.id);
  }
  const retained = candidates.filter((candidate) => keep.has(candidate.id));
  try {
    await writeAtomic(historyManifestPath(id), JSON.stringify(retained, null, 2));
  } catch (error) {
    await markHistoryDegraded(id);
    throw error;
  }
  for (const candidate of candidates) {
    if (keep.has(candidate.id) || candidate.file === file || !/^[0-9a-f-]+\.mmd$/.test(candidate.file)) continue;
    await unlink(safePath(historyDir(id), candidate.file)).catch(() => undefined);
  }
  return point;
}

async function markHistoryDegraded(id: string): Promise<void> {
  const meta = await readMeta(id);
  if (!meta) return;
  await writeMeta({ ...meta, historyDegraded: true, updatedAt: Date.now() }).catch(() => undefined);
}

async function clearHistoryDegraded(id: string): Promise<void> {
  const meta = await readMeta(id);
  if (!meta || !meta.historyDegraded) return;
  await writeMeta({ ...meta, historyDegraded: false, updatedAt: Date.now() }).catch(() => undefined);
}

export async function readHistory(id: string): Promise<RecoveryPoint[]> {
  const manifest = await readJson<RecoveryPoint[]>(historyManifestPath(id));
  return Array.isArray(manifest) ? manifest.filter((point) => point && typeof point.file === 'string') : [];
}

export async function readRecoveryPoint(id: string, pointId: string): Promise<{ point: RecoveryPoint; source: string } | null> {
  const point = (await readHistory(id)).find((candidate) => candidate.id === pointId);
  if (!point || !/^[0-9a-f-]+\.mmd$/.test(point.file)) return null;
  try {
    const source = await readFile(safePath(historyDir(id), point.file), 'utf8');
    if (checksum(source) !== point.checksum) throw new Error('checksum mismatch');
    return { point, source };
  } catch {
    return null;
  }
}

async function recoverDiagramForRevision(id: string, expectedChecksum: string): Promise<string | null> {
  const candidate = (await readHistory(id)).find((point) => point.checksum === expectedChecksum);
  if (!candidate || !/^[0-9a-f-]+\.mmd$/.test(candidate.file)) return null;
  try {
    const source = await readFile(safePath(historyDir(id), candidate.file), 'utf8');
    if (checksum(source) !== expectedChecksum) return null;
    await writeAtomic(diagramPath(id), source);
    console.warn(`MDVE repaired an unacknowledged diagram write for ${id} from revision ${candidate.revision}`);
    return source;
  } catch {
    return null;
  }
}

async function ensureSessionState(id: string): Promise<SessionMeta | null> {
  const meta = await readMeta(id);
  if (!meta) return null;
  let current = await readDiagram(id);
  if (current === null) return null;
  const revision = await readRevision(id);
  if (revision) {
    if (checksum(current) !== revision.checksum) {
      const turn = meta.agentLease ? await readJson<AgentTurnRecord>(turnPath(id)) : null;
      if (meta.agentLease && turn?.status === 'running') {
        // An agent writes diagram.mmd directly while its lease is active. Keep
        // that unacknowledged source visible until finishAgentTurn can reconcile
        // it into the next durable revision; repairing it here would erase the
        // agent's result before the completion boundary sees it.
        return { ...meta, schemaVersion: DATA_SCHEMA_VERSION, revision: revision.revision, checksum: revision.checksum };
      }
      current = await recoverDiagramForRevision(id, revision.checksum);
      if (current === null) {
        console.error(`MDVE found an unrecoverable diagram/revision checksum mismatch for ${id}`);
        return null;
      }
    }
    if (meta.revision !== revision.revision || meta.checksum !== revision.checksum || meta.schemaVersion !== DATA_SCHEMA_VERSION) {
      await writeMeta({
        ...meta,
        schemaVersion: DATA_SCHEMA_VERSION,
        revision: revision.revision,
        checksum: revision.checksum,
      }).catch(() => undefined);
    }
    return { ...meta, schemaVersion: DATA_SCHEMA_VERSION, revision: revision.revision, checksum: revision.checksum };
  }

  const initial: RevisionRecord = {
    revision: Math.max(1, meta.revision || 1),
    checksum: checksum(current),
    updatedAt: meta.updatedAt,
    origin: 'system',
  };
  await mkdir(historyDir(id), { recursive: true });
  await writeRevision(id, initial);
  const point = await writeRecoveryPointFile(id, current, initial.revision, 'system');
  await writeMeta({
    ...meta,
    schemaVersion: DATA_SCHEMA_VERSION,
    revision: initial.revision,
    checksum: initial.checksum,
    historyDegraded: false,
    selectedConversationId: meta.selectedConversationId,
  });
  void point;
  return { ...meta, ...initial, schemaVersion: DATA_SCHEMA_VERSION, historyDegraded: false };
}

const sessionQueues = new Map<string, Promise<unknown>>();

function withSessionLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(id) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  const settled = pending.then(() => undefined, () => undefined).then(() => {
    if (sessionQueues.get(id) === settled) sessionQueues.delete(id);
  });
  sessionQueues.set(id, settled);
  return pending;
}

export async function updateMeta(id: string, patch: Partial<SessionMeta>): Promise<SessionMeta | null> {
  return withSessionLock(id, async () => {
    const meta = await readMeta(id);
    if (!meta) return null;
    const next = normalizeMeta({ ...meta, ...patch, id: meta.id, updatedAt: Date.now() });
    await writeMeta(next);
    return next;
  });
}

/** Keeps the agent brief current, including in workspaces created by older builds. */
export async function ensureAgentsFile(id: string): Promise<void> {
  const path = safePath(sessionDir(id), 'AGENTS.md');
  try {
    if ((await readFile(path, 'utf8')) === AGENTS_MD) return;
  } catch {
    /* missing — write it */
  }
  await writeAtomic(path, AGENTS_MD);
}

export async function createSession(opts: { title?: string; source?: string; origin?: LifecycleOrigin } = {}): Promise<SessionMeta> {
  const id = randomUUID();
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  const source = opts.source ?? DEFAULT_DIAGRAM;
  const now = Date.now();
  const initial: RevisionRecord = { revision: 1, checksum: checksum(source), updatedAt: now, origin: 'system' };
  await writeAtomic(safePath(dir, DIAGRAM_FILE), source);
  await writeRevision(id, initial);
  await ensureAgentsFile(id);
  await writeRecoveryPointFile(id, source, initial.revision, 'system');
  const meta: SessionMeta = normalizeMeta({
    id,
    title: opts.title?.trim() || 'Untitled diagram',
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    schemaVersion: DATA_SCHEMA_VERSION,
    revision: initial.revision,
    checksum: initial.checksum,
    historyDegraded: false,
    lastLifecycleAction: { action: 'new', origin: opts.origin ?? 'user', at: now },
  });
  await writeMeta(meta);
  return meta;
}

export type SessionScope = 'recent' | 'active' | 'archived' | 'all' | 'trash';

export async function listSessions(scope: SessionScope = 'active', search = ''): Promise<SessionMeta[]> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const metas: SessionMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await ensureSessionState(entry.name);
    if (meta) metas.push(meta);
  }
  const needle = search.trim().toLocaleLowerCase();
  const matching = [] as SessionMeta[];
  for (const meta of metas) {
    if (scope === 'trash') {
      if (!meta.trashed) continue;
    } else {
      if (meta.trashed) continue;
      if (scope === 'archived' && !meta.archived) continue;
      if ((scope === 'active' || scope === 'recent') && meta.archived) continue;
    }
    const source = (await readDiagram(meta.id)) ?? '';
    if (needle) {
      if (!meta.title.toLocaleLowerCase().includes(needle) && !source.toLocaleLowerCase().includes(needle)) continue;
    }
    const summary = source.split('\n').find((line) => line.trim() && !line.trim().startsWith('%%'))?.trim() ?? 'Empty Mermaid source';
    matching.push({ ...meta, sourceSummary: summary.slice(0, 96) });
  }
  return matching
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export async function writeDiagram(
  id: string,
  source: string,
  opts: { expectedRevision?: number; origin?: RevisionOrigin; turnId?: string; allowDuringAgent?: boolean; forceRevision?: boolean } = {},
): Promise<SaveResult> {
  return withSessionLock(id, async () => {
    const meta = await ensureSessionState(id);
    if (!meta) throw new Error('No such session');
    if (meta.agentLease && !opts.allowDuringAgent && opts.origin !== 'agent') throw new AgentLeaseError(meta.agentLease);
    const current = await readDiagram(id);
    const revision = await readRevision(id);
    if (current === null || !revision) throw new Error('Diagram durability state is unavailable');
    if (opts.expectedRevision !== undefined && opts.expectedRevision !== revision.revision) {
      throw new RevisionConflictError(opts.expectedRevision, revision.revision, current);
    }
    if (current === source && !opts.forceRevision) return { revision: revision.revision, checksum: revision.checksum, origin: opts.origin ?? 'manual' };

    const next: RevisionRecord = {
      revision: revision.revision + 1,
      checksum: checksum(source),
      updatedAt: Date.now(),
      origin: opts.origin ?? 'manual',
      turnId: opts.turnId,
    };
    try {
      await writeAtomic(diagramPath(id), source);
      await writeRevision(id, next);
    } catch (error) {
      // A directory sync can fail after rename has made the new file visible.
      // Replacing the old source is therefore part of the failed-write path,
      // not an optional cleanup after a successful writeAtomic call.
      await writeAtomic(diagramPath(id), current).catch(() => undefined);
      // The revision write can also have completed its rename before a later
      // durability step failed. Restore the old revision record as well; an
      // old source paired with the new checksum is not a recoverable state.
      await writeAtomic(revisionPath(id), JSON.stringify(revision, null, 2)).catch(() => undefined);
      throw error;
    }

    const nextMeta = normalizeMeta({
      ...meta,
      revision: next.revision,
      checksum: next.checksum,
      updatedAt: next.updatedAt,
      lastActivityAt: next.updatedAt,
      schemaVersion: DATA_SCHEMA_VERSION,
    });
    await writeMeta(nextMeta).catch(() => undefined);
    return { revision: next.revision, checksum: next.checksum, origin: next.origin };
  });
}

export async function getDiagramState(id: string): Promise<DiagramState | null> {
  const meta = await ensureSessionState(id);
  if (!meta) return null;
  const source = await readDiagram(id);
  const revision = await readRevision(id);
  if (source === null || !revision) return null;
  return { revision: revision.revision, checksum: revision.checksum, source };
}

async function reconcileDiagramUnlocked(
  id: string,
  origin: RevisionOrigin,
  turnId?: string,
): Promise<SaveResult | null> {
  const meta = await ensureSessionState(id);
  const source = await readDiagram(id);
  const revision = await readRevision(id);
  if (!meta || source === null || !revision) throw new Error('Diagram durability state is unavailable');
  const digest = checksum(source);
  if (digest === revision.checksum) return null;
  const next: RevisionRecord = {
    revision: revision.revision + 1,
    checksum: digest,
    updatedAt: Date.now(),
    origin,
    turnId,
  };
  // Agents write the canonical file with their own file tools. Replacing it
  // again here makes the completion boundary use MDVE's durable primitive
  // before the new revision is acknowledged.
  await writeAtomic(diagramPath(id), source);
  await writeRevision(id, next);
  await writeMeta(normalizeMeta({ ...meta, ...next, schemaVersion: DATA_SCHEMA_VERSION, lastActivityAt: next.updatedAt })).catch(() => undefined);
  return { revision: next.revision, checksum: next.checksum, origin };
}

export async function reconcileDiagram(id: string, origin: RevisionOrigin = 'agent', turnId?: string): Promise<SaveResult | null> {
  return withSessionLock(id, () => reconcileDiagramUnlocked(id, origin, turnId));
}

/** Compatibility helper retained for callers that need a pre-agent checkpoint. */
export async function snapshotDiagram(id: string): Promise<string | null> {
  const point = await createRecoveryPoint(id, 'agent');
  return point ? safePath(historyDir(id), point.file) : null;
}

export async function createRecoveryPoint(
  id: string,
  origin: RevisionOrigin,
  opts: { turnId?: string; outcome?: AgentTurnStatus } = {},
): Promise<RecoveryPoint | null> {
  const state = await getDiagramState(id);
  if (!state || state.source.trim() === '') return null;
  try {
    const point = await writeRecoveryPointFile(id, state.source, state.revision, origin, opts.turnId, opts.outcome);
    await clearHistoryDegraded(id);
    return point;
  } catch (error) {
    await markHistoryDegraded(id);
    throw error;
  }
}

export async function restoreRecoveryPoint(id: string, pointId: string): Promise<SaveResult> {
  const point = await readRecoveryPoint(id, pointId);
  if (!point) throw new Error('Recovery point is missing or damaged');
  const state = await getDiagramState(id);
  if (!state) throw new Error('Diagram durability state is unavailable');
  await writeRecoveryPointFile(id, state.source, state.revision, 'restore');
  const result = await writeDiagram(id, point.source, { expectedRevision: state.revision, origin: 'restore', forceRevision: true });
  await writeRecoveryPointFile(id, point.source, result.revision, 'restore');
  return result;
}

export async function listConversations(sessionId: string): Promise<ConversationRecord[]> {
  await ensureSessionState(sessionId);
  try {
    const entries = await readdir(conversationsDir(sessionId), { withFileTypes: true });
    const records: ConversationRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const record = await readJson<ConversationRecord>(safePath(conversationsDir(sessionId), entry.name));
      if (record) records.push(record);
    }
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function readConversation(sessionId: string, conversationId: string): Promise<ConversationRecord | null> {
  return readJson<ConversationRecord>(conversationPath(sessionId, conversationId));
}

async function setConversationArchived(sessionId: string, conversationId: string, archived: boolean): Promise<ConversationRecord | null> {
  return withSessionLock(sessionId, async () => {
    const current = await readConversation(sessionId, conversationId);
    if (!current) return null;
    const meta = await readMeta(sessionId);
    if (archived && meta?.agentLease?.conversationId === conversationId) throw new AgentLeaseError(meta.agentLease);
    const next: ConversationRecord = { ...current, archived, updatedAt: Date.now() };
    await writeConversation(sessionId, next);
    return next;
  });
}

export function archiveConversation(sessionId: string, conversationId: string): Promise<ConversationRecord | null> {
  return setConversationArchived(sessionId, conversationId, true);
}

export function restoreConversation(sessionId: string, conversationId: string): Promise<ConversationRecord | null> {
  return setConversationArchived(sessionId, conversationId, false);
}

export async function createConversation(
  sessionId: string,
  opts: { title?: string; provider?: string } = {},
): Promise<ConversationRecord> {
  return withSessionLock(sessionId, async () => {
    const state = await getDiagramState(sessionId);
    if (!state) throw new Error('No such session');
    const now = Date.now();
    const record: ConversationRecord = {
      id: randomUUID(),
      title: opts.title?.trim() || 'New conversation',
      provider: opts.provider ?? 'codex',
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      startingRevision: state.revision,
      lastRevision: state.revision,
      messages: [],
    };
    await mkdir(conversationsDir(sessionId), { recursive: true });
    await writeAtomic(conversationPath(sessionId, record.id), JSON.stringify(record, null, 2));
    const meta = await readMeta(sessionId);
    if (meta) await writeMeta({ ...meta, selectedConversationId: record.id });
    return record;
  });
}

async function writeConversation(sessionId: string, record: ConversationRecord): Promise<void> {
  await mkdir(conversationsDir(sessionId), { recursive: true });
  await writeAtomic(conversationPath(sessionId, record.id), JSON.stringify(record, null, 2));
}

export async function updateConversation(
  sessionId: string,
  conversationId: string,
  patch: Partial<ConversationRecord>,
): Promise<ConversationRecord | null> {
  return withSessionLock(sessionId, async () => {
    const current = await readConversation(sessionId, conversationId);
    if (!current) return null;
    const next: ConversationRecord = { ...current, ...patch, id: current.id, updatedAt: Date.now() };
    await writeConversation(sessionId, next);
    return next;
  });
}

export async function beginAgentTurn(
  sessionId: string,
  conversationId: string,
  opts: { prompt: string; provider: string; providerThreadId?: string; model?: string; effort?: string },
): Promise<AgentTurnRecord> {
  return withSessionLock(sessionId, async () => {
    const meta = await ensureSessionState(sessionId);
    const state = await getDiagramState(sessionId);
    const conversation = await readConversation(sessionId, conversationId);
    if (!meta || !state || !conversation) throw new Error('Conversation or Diagram does not exist');
    if (meta.agentLease) throw new AgentLeaseError(meta.agentLease);
    const pre = await createRecoveryPoint(sessionId, 'agent');
    if (!pre) throw new Error('Could not create the pre-agent recovery point');
    const now = Date.now();
    const turn: AgentTurnRecord = {
      id: randomUUID(),
      conversationId,
      provider: opts.provider,
      providerThreadId: opts.providerThreadId,
      model: opts.model,
      effort: opts.effort,
      prompt: opts.prompt,
      status: 'running',
      startedAt: now,
      startingRevision: state.revision,
      preRecoveryPointId: pre.id,
      trace: [],
    };
    await writeAtomic(turnPath(sessionId), JSON.stringify(turn, null, 2));
    await writeConversation(sessionId, {
      ...conversation,
      provider: opts.provider,
      providerThreadId: opts.providerThreadId ?? conversation.providerThreadId,
      status: 'running',
      updatedAt: now,
      messages: [...conversation.messages, { id: randomUUID(), role: 'user', text: opts.prompt, createdAt: now }],
    });
    await writeMeta({ ...meta, agentLease: { turnId: turn.id, conversationId, startedAt: now }, lastActivityAt: now, updatedAt: now });
    return turn;
  });
}

export async function readAgentTurn(sessionId: string): Promise<AgentTurnRecord | null> {
  return readJson<AgentTurnRecord>(turnPath(sessionId));
}

export async function appendTurnTrace(sessionId: string, line: string): Promise<void> {
  return withSessionLock(sessionId, async () => {
    const turn = await readAgentTurn(sessionId);
    if (!turn || turn.status !== 'running') return;
    await writeAtomic(turnPath(sessionId), JSON.stringify({ ...turn, trace: [...turn.trace, line].slice(-500) }, null, 2));
  });
}

export async function finishAgentTurn(
  sessionId: string,
  status: Exclude<AgentTurnStatus, 'running'>,
  opts: { finalResponse?: string; error?: string } = {},
): Promise<AgentTurnRecord | null> {
  return withSessionLock(sessionId, async () => {
    const turn = await readAgentTurn(sessionId);
    if (!turn) return null;
    await reconcileDiagramUnlocked(sessionId, 'agent', turn.id);
    const state = await getDiagramState(sessionId);
    if (!state) throw new Error('Diagram durability state is unavailable');
    const post = await createRecoveryPoint(sessionId, 'agent', { turnId: turn.id, outcome: status });
    const endedAt = Date.now();
    const finished: AgentTurnRecord = {
      ...turn,
      status,
      endedAt,
      endingRevision: state.revision,
      postRecoveryPointId: post?.id,
      finalResponse: opts.finalResponse,
      error: opts.error,
    };
    await writeAtomic(turnPath(sessionId), JSON.stringify(finished, null, 2));
    const conversation = await readConversation(sessionId, turn.conversationId);
    if (conversation) {
      await writeConversation(sessionId, {
        ...conversation,
        status: status === 'completed' ? 'ready' : status,
        updatedAt: endedAt,
        lastRevision: state.revision,
        messages: opts.finalResponse || opts.error || status !== 'completed'
          ? [
              ...conversation.messages,
              {
                id: randomUUID(),
                role: 'agent',
                text: opts.finalResponse || `Turn ${status}${opts.error ? `: ${opts.error}` : '.'}`,
                createdAt: endedAt,
                trace: turn.trace.length > 0 ? turn.trace : undefined,
                error: status !== 'completed',
              },
            ]
          : conversation.messages,
      });
    }
    const meta = await readMeta(sessionId);
    if (meta) await writeMeta({ ...meta, agentLease: undefined, lastActivityAt: endedAt, updatedAt: endedAt });
    return finished;
  });
}

/** Convert persisted running turns into explicit interrupted outcomes on boot. */
export async function recoverInterruptedTurns(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const turn = await readAgentTurn(entry.name);
    if (!turn || turn.status !== 'running') continue;
    try {
      await finishAgentTurn(entry.name, 'interrupted', { error: 'MDVE restarted while this Conversation turn was running' });
    } catch {
      const meta = await readMeta(entry.name);
      if (meta) await writeMeta({ ...meta, agentLease: undefined, historyDegraded: true, updatedAt: Date.now() }).catch(() => undefined);
    }
  }
}

export async function archiveSession(id: string, origin: LifecycleOrigin = 'user'): Promise<SessionMeta | null> {
  return withSessionLock(id, async () => {
    const meta = await ensureSessionState(id);
    if (!meta) return null;
    if (meta.agentLease) throw new AgentLeaseError(meta.agentLease);
    if (meta.trashed) throw new Error('A trashed Diagram must be restored before it can be archived');
    await createRecoveryPoint(id, 'manual');
    const now = Date.now();
    const next = normalizeMeta({
      ...meta,
      archived: true,
      updatedAt: now,
      lastActivityAt: meta.lastActivityAt,
      lastLifecycleAction: { action: 'archive', origin, at: now },
    });
    await writeMeta(next);
    return next;
  });
}

export async function trashSession(id: string, origin: LifecycleOrigin = 'user'): Promise<SessionMeta | null> {
  return withSessionLock(id, async () => {
    const meta = await ensureSessionState(id);
    if (!meta) return null;
    if (meta.agentLease) throw new AgentLeaseError(meta.agentLease);
    await createRecoveryPoint(id, 'manual');
    const now = Date.now();
    const next = normalizeMeta({
      ...meta,
      archived: false,
      trashed: true,
      trashedAt: now,
      updatedAt: now,
      lastActivityAt: meta.lastActivityAt,
      lastLifecycleAction: { action: 'trash', origin, at: now },
    });
    await writeMeta(next);
    return next;
  });
}

export async function restoreSession(id: string, origin: LifecycleOrigin = 'user'): Promise<SessionMeta | null> {
  return withSessionLock(id, async () => {
    const meta = await ensureSessionState(id);
    if (!meta) return null;
    if (meta.agentLease) throw new AgentLeaseError(meta.agentLease);
    const now = Date.now();
    const next = normalizeMeta({
      ...meta,
      archived: false,
      trashed: false,
      trashedAt: undefined,
      updatedAt: now,
      lastActivityAt: meta.lastActivityAt,
      lastLifecycleAction: { action: 'restore', origin, at: now },
    });
    await writeMeta(next);
    return next;
  });
}

/** Permanent deletion is deliberately only callable after a Diagram entered Trash. */
export async function permanentlyDeleteSession(id: string, origin: LifecycleOrigin = 'user'): Promise<boolean> {
  return withSessionLock(id, async () => {
    const meta = await ensureSessionState(id);
    if (!meta) return false;
    if (!meta.trashed) throw new Error('Only trashed Diagrams can be permanently deleted');
    if (meta.agentLease) throw new AgentLeaseError(meta.agentLease);
    // The path is derived from a validated identifier and scoped below SESSIONS_DIR.
    await rm(sessionDir(id), { recursive: true, force: false });
    void origin;
    return true;
  });
}

export async function ensureRoot(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const removed = await removeAbandonedTemporaryFiles(SESSIONS_DIR);
  if (removed > 0) console.warn(`MDVE removed ${removed} abandoned temporary durability file(s) during recovery`);
  await recoverInterruptedTurns();
}

/** Most recent session, creating one when the store is empty. */
let startupOperation: Promise<SessionMeta> | undefined;

export async function latestOrCreate(selectedId?: string): Promise<SessionMeta> {
  if (startupOperation) return startupOperation;
  startupOperation = (async () => {
    if (selectedId && isSafeIdentifier(selectedId)) {
      const selected = await ensureSessionState(selectedId);
      if (selected && !selected.archived && !selected.trashed) return selected;
    }
    const sessions = await listSessions('active');
    if (sessions.length > 0) return sessions[0];
    return createSession({ origin: 'system' });
  })();
  try {
    return await startupOperation;
  } finally {
    startupOperation = undefined;
  }
}

export async function sessionExists(id: string): Promise<boolean> {
  try {
    const s = await stat(sessionDir(id));
    return s.isDirectory();
  } catch {
    return false;
  }
}
