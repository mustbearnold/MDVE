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

test('every atomic-write fault point leaves the previous revision authoritative', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-fault-'));
  setDataRoot(root);
  try {
    for (const point of ['temporary-create', 'partial-write', 'file-sync', 'close', 'rename', 'directory-sync'] as const) {
      const session = await createSession({ source: 'flowchart TD\n  A --> B\n' });
      let armed = true;
      setDurabilityFaultInjector((candidate) => {
        if (candidate === point && armed) {
          armed = false;
          throw new Error(`injected ${point} failure`);
        }
      });
      await assert.rejects(() => writeDiagram(session.id, 'flowchart LR\n  A --> C\n', { expectedRevision: 1 }));
      setDurabilityFaultInjector();
      const state = await getDiagramState(session.id);
      assert.equal(state?.revision, 1, point);
      assert.equal(state?.source, 'flowchart TD\n  A --> B\n', point);
    }
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
    const restoredAgain = history.find((point) => point.revision === 3 && point.origin === 'restore');
    assert.ok(restoredAgain);
    assert.equal((await restoreRecoveryPoint(session.id, restoredAgain.id)).revision, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('history retains the newest 100 points after older points leave the 30-day window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-retention-'));
  const realNow = Date.now;
  const oldNow = realNow() - 31 * 24 * 60 * 60 * 1000;
  setDataRoot(root);
  try {
    Date.now = () => oldNow;
    const session = await createSession({ source: 'flowchart TD\n  A --> B\n' });
    for (let index = 0; index < 120; index += 1) {
      const state = await getDiagramState(session.id);
      assert.ok(state);
      await writeDiagram(session.id, `flowchart TD\n  A --> N${index}\n`, { expectedRevision: state.revision });
      await createRecoveryPoint(session.id, 'manual');
    }

    Date.now = realNow;
    await createRecoveryPoint(session.id, 'restore');
    const history = await readHistory(session.id);
    assert.equal(history.length, 100);
    assert.equal(history.at(-1)?.origin, 'restore');
    assert.ok(history.every((point) => point.revision >= 22));
    assert.equal((await getDiagramState(session.id))?.source, 'flowchart TD\n  A --> N119\n');
  } finally {
    Date.now = realNow;
    await rm(root, { recursive: true, force: true });
  }
});
