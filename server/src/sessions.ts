/**
 * Session workspaces.
 *
 * Each session is a directory holding `diagram.mmd` plus an AGENTS.md that
 * tells the agent what the file is for. Giving the agent a real file to edit
 * means we reuse its native read/write tools instead of inventing a tool
 * protocol, and the file is also the crash-safe store for the editor.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ROOT = process.env.MDVE_HOME ?? join(homedir(), '.mdve');
export const SESSIONS_DIR = join(ROOT, 'sessions');

export const DIAGRAM_FILE = 'diagram.mmd';

export const DEFAULT_DIAGRAM = `flowchart TD
  start([Start]) --> collect[Collect requirements]
  collect --> decide{Scope clear?}
  decide -->|yes| build[Build it]
  decide -->|no| collect
  build --> ship([Ship])
`;

const AGENTS_MD = `# MDVE session workspace

This directory belongs to MDVE, a Mermaid diagram editor. The user is looking
at a live rendering of \`${DIAGRAM_FILE}\` while you work.

Rules:

- \`${DIAGRAM_FILE}\` is the diagram. To change what the user sees, edit that file.
- Always read \`${DIAGRAM_FILE}\` before editing it; the user may have changed it
  since your last turn.
- Keep the file valid Mermaid. If you are unsure a construct renders, prefer the
  plain flowchart syntax.
- Preserve existing node ids unless asked to rename them; the editor tracks
  selection by id.
- Do not create other files, run builds, or install anything. This workspace has
  no project in it — only the diagram.
- Reply with a one or two sentence summary of what you changed. Do not paste the
  whole diagram back; the user can already see it.
`;

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  threadId?: string;
  provider?: string;
  model?: string;
}

function metaPath(id: string): string {
  return join(SESSIONS_DIR, id, 'session.json');
}

export function sessionDir(id: string): string {
  return join(SESSIONS_DIR, id);
}

export function diagramPath(id: string): string {
  return join(SESSIONS_DIR, id, DIAGRAM_FILE);
}

async function writeMeta(meta: SessionMeta): Promise<void> {
  await writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf8');
}

export async function readMeta(id: string): Promise<SessionMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(id), 'utf8')) as SessionMeta;
  } catch {
    return null;
  }
}

export async function updateMeta(id: string, patch: Partial<SessionMeta>): Promise<SessionMeta | null> {
  const meta = await readMeta(id);
  if (!meta) return null;
  const next = { ...meta, ...patch, id: meta.id, updatedAt: Date.now() };
  await writeMeta(next);
  return next;
}

export async function createSession(opts: { title?: string; source?: string } = {}): Promise<SessionMeta> {
  const id = randomUUID();
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, DIAGRAM_FILE), opts.source ?? DEFAULT_DIAGRAM, 'utf8');
  await writeFile(join(dir, 'AGENTS.md'), AGENTS_MD, 'utf8');
  const now = Date.now();
  const meta: SessionMeta = {
    id,
    title: opts.title ?? 'Untitled diagram',
    createdAt: now,
    updatedAt: now,
  };
  await writeMeta(meta);
  return meta;
}

export async function listSessions(): Promise<SessionMeta[]> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const metas: SessionMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readMeta(entry.name);
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readDiagram(id: string): Promise<string | null> {
  try {
    return await readFile(diagramPath(id), 'utf8');
  } catch {
    return null;
  }
}

export async function writeDiagram(id: string, source: string): Promise<void> {
  await writeFile(diagramPath(id), source, 'utf8');
}

export async function ensureRoot(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

/** Most recent session, creating one when the store is empty. */
export async function latestOrCreate(): Promise<SessionMeta> {
  const sessions = await listSessions();
  if (sessions.length > 0) return sessions[0];
  return createSession();
}

export async function sessionExists(id: string): Promise<boolean> {
  try {
    const s = await stat(sessionDir(id));
    return s.isDirectory();
  } catch {
    return false;
  }
}
