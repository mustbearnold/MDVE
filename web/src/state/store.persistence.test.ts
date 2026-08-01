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

test('pending edits for different Diagrams are both persisted', async () => {
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

test('switching Diagrams flushes the current edit before loading the target', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const events: string[] = [];

  globalThis.localStorage = { setItem: () => undefined } as unknown as Storage;
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    if (path === '/api/sessions/alpha/diagram' && init?.method === 'PUT') {
      events.push('save-alpha');
      return Response.json({ ok: true });
    }
    if (path === '/api/sessions/bravo') {
      events.push('load-bravo');
      return Response.json({
        session: session('bravo'),
        source: 'flowchart TD\n  bravo[Bravo]',
        workspace: '/tmp/bravo',
      });
    }
    if (path === '/api/sessions' || path === '/api/sessions?scope=recent') return Response.json({ sessions: [session('alpha'), session('bravo')] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch;

  try {
    useStore.setState({
      session: session('alpha'),
      source: 'flowchart TD\n  alpha[Alpha]',
      past: [],
      future: [],
    });
    useStore.getState().setSource('flowchart TD\n  alpha[Latest]');

    await useStore.getState().loadSession('bravo');

    assert.deepEqual(events, ['save-alpha', 'load-bravo']);
    assert.equal(useStore.getState().session?.id, 'bravo');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});
