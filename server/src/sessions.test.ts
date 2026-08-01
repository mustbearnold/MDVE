import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createConversation,
  createRecoveryPoint,
  createSession,
  finishAgentTurn,
  getDiagramState,
  readAgentTurn,
  readHistory,
  recoverInterruptedTurns,
  setDataRoot,
  setDurabilityFaultInjector,
  writeDiagram,
  RevisionConflictError,
  beginAgentTurn,
  restoreRecoveryPoint,
} from './sessions.js';

test('durable revisions reject stale writers and preserve recovery points', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-sessions-'));
  setDataRoot(root);
  try {
    const session = await createSession({ source: 'flowchart TD\n  A --> B\n' });
    const initial = await getDiagramState(session.id);
    assert.equal(initial?.revision, 1);

    const saved = await writeDiagram(session.id, 'flowchart LR\n  A --> B\n', { expectedRevision: 1 });
    assert.equal(saved.revision, 2);
    await createRecoveryPoint(session.id, 'manual');

    await assert.rejects(
      () => writeDiagram(session.id, 'flowchart LR\n  A --> C\n', { expectedRevision: 1 }),
      (error: unknown) => error instanceof RevisionConflictError && error.actualRevision === 2,
    );
    const history = await readHistory(session.id);
    assert.equal(history.length, 2);
    assert.equal((await getDiagramState(session.id))?.source, 'flowchart LR\n  A --> B\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed directory sync does not acknowledge or expose a partial revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-fault-'));
  setDataRoot(root);
  try {
    const session = await createSession({ source: 'flowchart TD\n  A --> B\n' });
    let armed = true;
    setDurabilityFaultInjector((point) => {
      if (point === 'directory-sync' && armed) {
        armed = false;
        throw new Error('injected directory sync failure');
      }
    });
    await assert.rejects(() => writeDiagram(session.id, 'flowchart LR\n  A --> C\n', { expectedRevision: 1 }));
    setDurabilityFaultInjector();
    const state = await getDiagramState(session.id);
    assert.equal(state?.revision, 1);
    assert.equal(state?.source, 'flowchart TD\n  A --> B\n');
  } finally {
    setDurabilityFaultInjector();
    await rm(root, { recursive: true, force: true });
  }
});

test('agent turns persist a lease and recover running work as interrupted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-turns-'));
  setDataRoot(root);
  try {
    const session = await createSession();
    const conversation = await createConversation(session.id);
    const turn = await beginAgentTurn(session.id, conversation.id, { prompt: 'Add a path', provider: 'codex' });
    assert.equal((await readAgentTurn(session.id))?.status, 'running');
    await recoverInterruptedTurns();
    const recovered = await readAgentTurn(session.id);
    assert.equal(recovered?.id, turn.id);
    assert.equal(recovered?.status, 'interrupted');
    assert.equal((await getDiagramState(session.id))?.revision, 1);

    const second = await beginAgentTurn(session.id, conversation.id, { prompt: 'Try again', provider: 'codex' });
    const finished = await finishAgentTurn(session.id, 'completed', { finalResponse: 'Done' });
    assert.equal(finished?.id, second.id);
    assert.equal(finished?.status, 'completed');
    const meta = JSON.parse(await readFile(join(root, 'sessions', session.id, 'session.json'), 'utf8')) as { agentLease?: unknown };
    assert.equal(meta.agentLease, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restoring identical source records a visible lifecycle recovery point', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-restore-'));
  setDataRoot(root);
  try {
    const session = await createSession({ source: 'flowchart TD\n  A --> B\n' });
    const initialPoint = (await readHistory(session.id))[0];
    await writeDiagram(session.id, 'flowchart LR\n  A --> B\n', { expectedRevision: 1 });
    await createRecoveryPoint(session.id, 'manual');
    const restored = await restoreRecoveryPoint(session.id, initialPoint.id);
    assert.equal(restored.revision, 3);
    const history = await readHistory(session.id);
    assert.ok(history.some((point) => point.revision === 3 && point.origin === 'restore'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
