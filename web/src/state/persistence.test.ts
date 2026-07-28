import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiagramPersistence, type SaveStatus } from './persistence';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('a newer edit is saved after an in-flight write without racing it', async () => {
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const saved: string[] = [];

  const persistence = createDiagramPersistence(
    async (_sessionId, source) => {
      saved.push(source);
      if (saved.length === 1) await firstWrite;
    },
    { delayMs: 0 },
  );

  persistence.schedule('alpha', 'first');
  await wait(5);
  persistence.schedule('alpha', 'latest');
  releaseFirst();
  await persistence.flush('alpha');

  assert.deepEqual(saved, ['first', 'latest']);
  assert.deepEqual(persistence.status('alpha'), { state: 'saved' });
  persistence.dispose();
});

test('a failed write stays retryable and reports its state', async () => {
  let attempts = 0;
  const states: SaveStatus[] = [];
  const persistence = createDiagramPersistence(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('disk unavailable');
    },
    { delayMs: 1_000, onStatus: (_sessionId, status) => states.push(status) },
  );

  persistence.schedule('alpha', 'diagram');
  await persistence.flush('alpha');
  assert.deepEqual(persistence.status('alpha'), { state: 'error', message: 'disk unavailable' });

  await persistence.retry('alpha');
  assert.equal(attempts, 2);
  assert.deepEqual(persistence.status('alpha'), { state: 'saved' });
  assert.equal(states.at(-1)?.state, 'saved');
  persistence.dispose();
});
