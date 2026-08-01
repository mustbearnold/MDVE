import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AgentEvent } from './types.js';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('Codex app-server adapter covers auth, catalog, new/resumed turns, interruption, and unavailable threads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-codex-fixture-'));
  const fakeCodex = join(root, 'codex');
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
import readline from 'node:readline';

if (process.argv.includes('--version')) {
  console.log(process.env.FAKE_CODEX_VERSION ?? 'codex-cli 0.146.0');
  process.exit(0);
}

const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const lines = readline.createInterface({ input: process.stdin });
let pendingSlowTurn = false;

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { serverInfo: { name: 'fixture', version: process.env.FAKE_CODEX_SERVER_VERSION ?? '0.146.0' } } });
  } else if (message.method === 'account/read') {
    if (process.env.FAKE_CODEX_AUTH === '0') send({ id: message.id, result: { account: null } });
    else send({ id: message.id, result: { account: { type: 'chatgpt', email: 'fixture@example.test' } } });
  } else if (message.method === 'model/list') {
    send({ id: message.id, result: { data: [{ id: 'fixture-model', displayName: 'Fixture model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }] } });
  } else if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thread-fixture' } } });
  } else if (message.method === 'thread/resume') {
    if (message.params?.threadId === 'missing-thread') send({ id: message.id, error: { code: -32004, message: 'thread not found' } });
    else send({ id: message.id, result: { thread: { id: message.params?.threadId } } });
  } else if (message.method === 'turn/start') {
    pendingSlowTurn = message.params?.input?.[0]?.text === 'slow';
    send({ id: message.id, result: { turn: { id: 'turn-fixture' } } });
    setTimeout(() => send({ method: 'turn/started', params: { turn: { id: 'turn-fixture' } } }), 20);
    if (!pendingSlowTurn) {
      setTimeout(() => {
        send({ method: 'item/agentMessage/delta', params: { delta: 'fixture response' } });
        send({ method: 'turn/completed', params: { turn: { id: 'turn-fixture', status: message.params?.input?.[0]?.text === 'unknown' ? 'paused' : 'completed' } } });
      }, 40);
    }
  } else if (message.method === 'turn/interrupt') {
    pendingSlowTurn = false;
    send({ id: message.id, result: {} });
    setTimeout(() => send({ method: 'turn/completed', params: { turn: { id: 'turn-fixture', status: 'interrupted' } } }), 20);
  }
});
`,
    'utf8',
  );
  await chmod(fakeCodex, 0o755);
  const previousBin = process.env.MDVE_CODEX_BIN;
  const previousAuth = process.env.FAKE_CODEX_AUTH;
  const previousVersion = process.env.FAKE_CODEX_VERSION;
  const previousServerVersion = process.env.FAKE_CODEX_SERVER_VERSION;
  process.env.MDVE_CODEX_BIN = fakeCodex;
  delete process.env.FAKE_CODEX_AUTH;
  delete process.env.FAKE_CODEX_VERSION;

  try {
    const { CodexProvider } = await import(`./codex.js?fixture=${Date.now()}`);
    const provider = new CodexProvider();
    const status = await provider.status();
    assert.equal(status.ok, true);
    assert.match(status.detail, /ChatGPT account/);
    assert.doesNotMatch(status.detail, /fixture@example\.test/);

    const catalog = await provider.catalog();
    assert.deepEqual(catalog.models[0], {
      id: 'fixture-model',
      label: 'Fixture model',
      efforts: ['low', 'medium'],
      defaultEffort: 'medium',
      deprecated: undefined,
    });
    assert.equal(catalog.defaultModel, 'fixture-model');

    const firstEvents: AgentEvent[] = [];
    await provider.run(
      { prompt: 'first', workspace: root, model: 'fixture-model', effort: 'medium', signal: new AbortController().signal },
      (event: AgentEvent) => firstEvents.push(event),
    );
    assert.ok(firstEvents.some((event) => event.type === 'thread' && event.threadId === 'thread-fixture'));
    assert.ok(firstEvents.some((event) => event.type === 'message' && event.text === 'fixture response'));

    const resumedEvents: AgentEvent[] = [];
    await provider.run(
      { prompt: 'resume', workspace: root, threadId: 'thread-fixture', signal: new AbortController().signal },
      (event: AgentEvent) => resumedEvents.push(event),
    );
    assert.ok(resumedEvents.some((event) => event.type === 'message'));

    await assert.rejects(
      () => provider.run({ prompt: 'unknown', workspace: root, threadId: 'thread-fixture', signal: new AbortController().signal }, () => undefined),
      /unsupported status paused/,
    );

    const controller = new AbortController();
    const interrupted = provider.run(
      { prompt: 'slow', workspace: root, threadId: 'thread-fixture', signal: controller.signal },
      () => undefined,
    );
    await wait(80);
    controller.abort();
    await interrupted;

    await assert.rejects(
      () => provider.run({ prompt: 'missing', workspace: root, threadId: 'missing-thread', signal: new AbortController().signal }, () => undefined),
      /thread not found/,
    );

    process.env.FAKE_CODEX_AUTH = '0';
    assert.equal((await provider.status()).ok, false);
    assert.match((await provider.status()).detail, /not logged in/);
    delete process.env.FAKE_CODEX_AUTH;
    process.env.FAKE_CODEX_SERVER_VERSION = '0.145.0';
    assert.equal((await provider.status()).ok, false);
    assert.match((await provider.status()).detail, /app-server .*outside MDVE's tested range/);
    delete process.env.FAKE_CODEX_SERVER_VERSION;
    process.env.FAKE_CODEX_VERSION = 'codex-cli 0.147.0';
    assert.equal((await provider.status()).ok, false);
    assert.match((await provider.status()).detail, /outside MDVE's tested range/);
  } finally {
    if (previousBin === undefined) delete process.env.MDVE_CODEX_BIN;
    else process.env.MDVE_CODEX_BIN = previousBin;
    if (previousAuth === undefined) delete process.env.FAKE_CODEX_AUTH;
    else process.env.FAKE_CODEX_AUTH = previousAuth;
    if (previousVersion === undefined) delete process.env.FAKE_CODEX_VERSION;
    else process.env.FAKE_CODEX_VERSION = previousVersion;
    if (previousServerVersion === undefined) delete process.env.FAKE_CODEX_SERVER_VERSION;
    else process.env.FAKE_CODEX_SERVER_VERSION = previousServerVersion;
    await rm(root, { recursive: true, force: true });
  }
});
