import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AgentLeaseError,
  RevisionConflictError,
  archiveSession,
  beginAgentTurn,
  createConversation,
  createRecoveryPoint,
  createSession,
  diagramPath,
  finishAgentTurn,
  getDiagramState,
  listSessions,
  readAgentTurn,
  readHistory,
  readMeta,
  recoverInterruptedTurns,
  restoreRecoveryPoint,
  restoreSession,
  setDataRoot,
  writeDiagram,
} from '../dist/server/sessions.js';

const operations = Number(process.env.MDVE_SOAK_OPERATIONS ?? 1_000);
const seed = Number(process.env.MDVE_SOAK_SEED ?? 0x4d445645);

function nextRandom(state) {
  let value = state.value;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value >>> 0;
  return state.value;
}

const root = await mkdtemp(join(tmpdir(), 'mdve-reliability-'));
const random = { value: seed >>> 0 };
const counts = {
  saves: 0,
  conflicts: 0,
  history: 0,
  agentTurns: 0,
  interruptedRestarts: 0,
  lifecycle: 0,
  restores: 0,
};

try {
  setDataRoot(root);
  const sessions = [];
  const acknowledged = new Map();
  for (let index = 0; index < 4; index += 1) {
    const session = await createSession({ title: `Soak ${index + 1}` });
    sessions.push(session.id);
    const state = await getDiagramState(session.id);
    assert.ok(state);
    acknowledged.set(session.id, { revision: state.revision, source: state.source });
  }

  const recordState = async (id) => {
    const state = await getDiagramState(id);
    assert.ok(state, `missing state for ${id}`);
    const known = acknowledged.get(id);
    assert.ok(known);
    assert.ok(state.revision >= known.revision, `revision regressed for ${id}`);
    if (state.revision !== known.revision) acknowledged.set(id, { revision: state.revision, source: state.source });
    else assert.equal(state.source, known.source, `source changed without an acknowledged revision for ${id}`);
    const meta = await readMeta(id);
    assert.ok(meta);
    assert.equal(meta.agentLease, undefined, `write lease remained after operation ${id}`);
    const turn = await readAgentTurn(id);
    assert.notEqual(turn?.status, 'running', `running turn remained after operation ${id}`);
  };

  const started = performance.now();
  for (let operation = 0; operation < operations; operation += 1) {
    const id = sessions[nextRandom(random) % sessions.length];
    const choice = nextRandom(random) % 100;
    const known = acknowledged.get(id);
    assert.ok(known);

    if (choice < 52) {
      const direction = operation % 2 === 0 ? 'TD' : 'LR';
      const source = `flowchart ${direction}\n  start[Start] --> n${operation}[Operation ${operation}]\n`;
      const saved = await writeDiagram(id, source, { expectedRevision: known.revision });
      assert.equal(saved.revision, known.revision + 1);
      acknowledged.set(id, { revision: saved.revision, source });
      await createRecoveryPoint(id, 'manual');
      counts.saves += 1;
    } else if (choice < 62) {
      const staleRevision = Math.max(0, known.revision - 1);
      await assert.rejects(
        () => writeDiagram(id, `${known.source}\n  stale[Stale]\n`, { expectedRevision: staleRevision }),
        (error) => error instanceof RevisionConflictError && error.actualRevision === known.revision,
      );
      counts.conflicts += 1;
    } else if (choice < 72) {
      await createRecoveryPoint(id, 'manual');
      counts.history += 1;
    } else if (choice < 80) {
      const conversation = await createConversation(id);
      const turn = await beginAgentTurn(id, conversation.id, { prompt: `Transform operation ${operation}`, provider: 'codex' });
      if (operation % 2 === 0) {
        const source = `flowchart TD\n  agent[Agent operation ${operation}] --> done[Done]\n`;
        await writeFile(diagramPath(id), source, 'utf8');
        const finished = await finishAgentTurn(id, 'completed', { finalResponse: 'Done' });
        assert.equal(finished?.id, turn.id);
        acknowledged.set(id, { revision: finished?.endingRevision ?? known.revision, source });
      } else {
        const finished = await finishAgentTurn(id, operation % 3 === 0 ? 'failed' : 'stopped', { error: 'controlled soak outcome' });
        assert.equal(finished?.id, turn.id);
        const state = await getDiagramState(id);
        assert.ok(state);
        acknowledged.set(id, { revision: state.revision, source: state.source });
      }
      counts.agentTurns += 1;
    } else if (choice < 85) {
      const conversation = await createConversation(id);
      await beginAgentTurn(id, conversation.id, { prompt: `Restart operation ${operation}`, provider: 'codex' });
      await recoverInterruptedTurns();
      const recovered = await readAgentTurn(id);
      assert.equal(recovered?.status, 'interrupted');
      const state = await getDiagramState(id);
      assert.ok(state);
      acknowledged.set(id, { revision: state.revision, source: state.source });
      counts.interruptedRestarts += 1;
    } else if (choice < 90) {
      await archiveSession(id);
      await restoreSession(id);
      counts.lifecycle += 1;
    } else if (choice < 94) {
      const history = await readHistory(id);
      const point = history.find((candidate) => candidate.revision < known.revision);
      if (point) {
        const restored = await restoreRecoveryPoint(id, point.id);
        const state = await getDiagramState(id);
        assert.ok(state);
        assert.equal(restored.revision, known.revision + 1);
        acknowledged.set(id, { revision: state.revision, source: state.source });
        counts.restores += 1;
      }
    } else {
      // A session switch is represented by validating the outgoing durable head
      // before reading the next Diagram, as the browser navigation path does.
      await recordState(id);
      const nextId = sessions[nextRandom(random) % sessions.length];
      await recordState(nextId);
    }

    await recordState(id);
    if (operation % 25 === 0) {
      const listed = await listSessions('all');
      assert.equal(listed.length, sessions.length);
      for (const sessionId of sessions) await recordState(sessionId);
    }
  }

  await recoverInterruptedTurns();
  for (const id of sessions) await recordState(id);
  const elapsedMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({ seed, operations, elapsedMs, sessions: sessions.length, counts }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
