import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionMeta } from '../api';
import { useStore } from './store';

const session = (id: string): SessionMeta => ({
  id,
  title: `Diagram ${id}`,
  createdAt: 1,
  updatedAt: 1,
});

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('pending edits for different sessions are both persisted', async () => {
  const originalFetch = globalThis.fetch;
  const savedSessionIds: string[] = [];

  globalThis.fetch = (async (input) => {
    const match = /\/api\/sessions\/([^/]+)\/diagram$/.exec(String(input));
    if (match) savedSessionIds.push(match[1]);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    useStore.setState({
      session: session('alpha'),
      source: 'flowchart TD\n  alpha[Alpha]',
      past: [],
      future: [],
    });
    useStore.getState().setSource('flowchart TD\n  alpha[Alpha changed]');

    useStore.setState({
      session: session('bravo'),
      source: 'flowchart TD\n  bravo[Bravo]',
      past: [],
      future: [],
    });
    useStore.getState().setSource('flowchart TD\n  bravo[Bravo changed]');

    await wait(350);

    assert.deepEqual(savedSessionIds.sort(), ['alpha', 'bravo']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
