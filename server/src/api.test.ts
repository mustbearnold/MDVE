import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Could not reserve a local test port'));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

test('authenticated API preserves revision, history, conversation, and archive contracts', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'mdve-api-'));
  const port = await freePort();
  process.env.MDVE_HOME = dataRoot;
  process.env.MDVE_PORT = String(port);
  process.env.MDVE_HOST = '127.0.0.1';
  process.env.MDVE_AUTH_REQUIRED = '1';
  process.env.MDVE_BOOTSTRAP_TOKEN = 'test-bootstrap-token';
  process.env.MDVE_NO_LISTEN = '1';

  const { app } = await import('./index.js');
  const { ensureRoot, setDataRoot } = await import('./sessions.js');
  setDataRoot(dataRoot);
  await ensureRoot();
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${port}`;
  const jsonHeaders = { 'content-type': 'application/json' };

  try {
    const ready = await fetch(`${base}/_mdve/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ok, true);

    const unauthorized = await fetch(`${base}/api/sessions`);
    assert.equal(unauthorized.status, 401);

    const badHost = await fetch(`http://localhost:${port}/api/sessions`);
    assert.equal(badHost.status, 400);

    const bootstrap = await fetch(`${base}/_auth/bootstrap?token=test-bootstrap-token`, { redirect: 'manual' });
    assert.equal(bootstrap.status, 302);
    const setCookie = (bootstrap.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()[0] ?? bootstrap.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookie = setCookie.split(';', 1)[0];

    const replay = await fetch(`${base}/_auth/bootstrap?token=test-bootstrap-token`, { redirect: 'manual' });
    assert.equal(replay.status, 401);
    const invalidOrigin = await fetch(`${base}/api/sessions`, { headers: { cookie, origin: 'http://evil.example' } });
    assert.equal(invalidOrigin.status, 403);
    const invalidDiagramId = await fetch(`${base}/api/sessions/not%2Fsafe`, { headers: { cookie } });
    assert.equal(invalidDiagramId.status, 400);

    const invalidCreateSource = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ source: 42 }),
    });
    assert.equal(invalidCreateSource.status, 400);

    const invalidCreateTitle = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ title: { nope: true } }),
    });
    assert.equal(invalidCreateTitle.status, 400);

    const startup = await fetch(`${base}/api/startup`, { headers: { cookie } });
    assert.equal(startup.status, 200);
    const starter = (await startup.json()).session as { id: string; revision: number };
    assert.equal(starter.revision, 1);

    const source = 'flowchart TD\n  start[Start] --> finish[Finish]\n';
    const saved = await fetch(`${base}/api/sessions/${starter.id}/diagram`, {
      method: 'PUT',
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ source, expectedRevision: 1 }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, 2);

    const stale = await fetch(`${base}/api/sessions/${starter.id}/diagram`, {
      method: 'PUT',
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ source: `${source}  stale\n`, expectedRevision: 1 }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).revision, 2);

    const searched = await fetch(`${base}/api/sessions?search=finish`, { headers: { cookie } });
    assert.equal(searched.status, 200);
    assert.equal((await searched.json()).sessions.length, 1);

    const history = await fetch(`${base}/api/sessions/${starter.id}/history`, { headers: { cookie } });
    assert.equal(history.status, 200);
    const historyPoints = (await history.json()).history as Array<{ id: string; revision: number }>;
    assert.ok(historyPoints.some((point) => point.revision === 1));
    assert.ok(historyPoints.some((point) => point.revision === 2));

    const createdConversation = await fetch(`${base}/api/sessions/${starter.id}/conversations`, {
      method: 'POST',
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ provider: 'codex' }),
    });
    assert.equal(createdConversation.status, 201);
    const conversation = (await createdConversation.json()).conversation as { id: string };

    const selected = await fetch(`${base}/api/sessions/${starter.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ selectedConversationId: conversation.id }),
    });
    assert.equal(selected.status, 200);

    const invalidPatchTitle = await fetch(`${base}/api/sessions/${starter.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ title: 42 }),
    });
    assert.equal(invalidPatchTitle.status, 400);

    const archived = await fetch(`${base}/api/sessions/${starter.id}/archive`, { method: 'POST', headers: { cookie } });
    assert.equal(archived.status, 200);
    const active = await fetch(`${base}/api/sessions?scope=active`, { headers: { cookie } });
    assert.equal((await active.json()).sessions.length, 0);
    const restored = await fetch(`${base}/api/sessions/${starter.id}/restore`, { method: 'POST', headers: { cookie } });
    assert.equal(restored.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(dataRoot, { recursive: true, force: true });
  }
});
