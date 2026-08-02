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

test('a newer Diagram load cannot be overwritten by a slower background load', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  let releaseStale!: () => void;
  const staleResponse = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });

  globalThis.localStorage = { setItem: () => undefined } as unknown as Storage;
  globalThis.fetch = (async (input) => {
    const path = String(input);
    if (path === '/api/sessions/stale') {
      await staleResponse;
      return Response.json({
        session: { ...session('stale'), archived: false },
        source: 'flowchart TD\n  stale[Stale]\n',
        revision: 1,
        checksum: 'stale',
        workspace: '/tmp/stale',
      });
    }
    if (path === '/api/sessions/fresh') {
      return Response.json({
        session: { ...session('fresh'), archived: true },
        source: 'flowchart TD\n  fresh[Fresh]\n',
        revision: 1,
        checksum: 'fresh',
        workspace: '/tmp/fresh',
      });
    }
    if (path === '/api/sessions?scope=recent') return Response.json({ sessions: [session('fresh')] });
    if (path === '/api/sessions/fresh/conversations') return Response.json({ conversations: [] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch;

  try {
    useStore.setState({ session: null, source: '', revision: 0, conversations: [], conversationId: null });
    const staleLoad = useStore.getState().loadSession('stale');
    await wait(5);
    await useStore.getState().loadSession('fresh');
    assert.equal(useStore.getState().session?.id, 'fresh');

    releaseStale();
    await staleLoad;
    assert.equal(useStore.getState().session?.id, 'fresh');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('agent source changes become reviewable proposals with keep and reject boundaries', async () => {
  const before = 'flowchart TD\n  start[Start] --> done[Done]\n';
  const after = 'flowchart TD\n  start[Begin] --> done[Done]\n';
  useStore.setState({
    session: null,
    source: before,
    agentProposal: null,
    busy: false,
    past: [],
    future: [],
  });

  useStore.getState().beginAgentProposal();
  useStore.getState().stageAgentSource(after, { revision: 2 });
  assert.equal(useStore.getState().agentProposal?.before, before);
  assert.equal(useStore.getState().agentProposal?.after, after);
  assert.deepEqual(useStore.getState().agentProposal?.delta.changedNodes, ['start']);
  assert.equal(useStore.getState().revision, 2);

  useStore.getState().rejectAgentProposal();
  assert.equal(useStore.getState().source, before);
  assert.equal(useStore.getState().agentProposal, null);

  useStore.getState().beginAgentProposal();
  useStore.getState().stageAgentSource(after);
  await useStore.getState().acceptAgentProposal();
  assert.equal(useStore.getState().source, after);
  assert.equal(useStore.getState().agentProposal, null);
});

test('keeping an agent proposal commits against its starting revision', async () => {
  const originalFetch = globalThis.fetch;
  const before = 'flowchart TD\n  start[Start] --> done[Done]\n';
  const after = 'flowchart TD\n  start[Begin] --> done[Done]\n';
  let request: { path: string; body: { source: string; expectedRevision: number; origin: string } } | undefined;

  globalThis.fetch = (async (input, init) => {
    request = {
      path: String(input),
      body: JSON.parse(String(init?.body)) as { source: string; expectedRevision: number; origin: string },
    };
    return Response.json({ ok: true, revision: 3, checksum: 'accepted', historyAvailable: true });
  }) as typeof fetch;

  try {
    useStore.setState({
      session: { ...session('proposal'), revision: 2 },
      source: before,
      revision: 2,
      agentProposal: null,
      busy: false,
      saveStatus: { state: 'saved' },
      past: [],
      future: [],
    });
    useStore.getState().beginAgentProposal();
    useStore.getState().stageAgentSource(after);
    await useStore.getState().acceptAgentProposal();

    assert.equal(request?.path, '/api/sessions/proposal/diagram');
    assert.deepEqual(request?.body, { source: after, expectedRevision: 2, origin: 'manual' });
    assert.equal(useStore.getState().revision, 3);
    assert.equal(useStore.getState().source, after);
    assert.equal(useStore.getState().agentProposal, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
