import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tempRoot = await mkdtemp(join(tmpdir(), 'mdve-install-lifecycle-'));
const prefix = join(tempRoot, 'global');
const dataRoot = join(tempRoot, 'data');
const fakeCodex = join(tempRoot, 'codex');
const port = 4192;
const origin = `http://127.0.0.1:${port}`;
const rollbackVersion = '0.9.0';

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function makeVersionedArchive(source, version) {
  const unpackRoot = join(tempRoot, `rollback-${version}`);
  const target = join(tempRoot, `mdve-${version}.tgz`);
  await mkdir(unpackRoot, { recursive: true });
  run('tar', ['-xzf', source, '-C', unpackRoot]);
  const manifestPath = join(unpackRoot, 'package', 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  run('tar', ['-czf', target, '-C', unpackRoot, 'package']);
  return target;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function startLauncher(launcher, env) {
  const child = spawn(launcher, ['--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const bootstrapPattern = /_auth\/bootstrap\?token=([0-9a-f]+)/;
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 15_000;
  while (!bootstrapPattern.test(output) && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`launcher exited before ready: ${output}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.match(output, new RegExp(`MDVE is ready at http://127\\.0\\.0\\.1:${port}`));
  const token = output.match(bootstrapPattern)?.[1];
  assert.ok(token, 'launcher did not expose a bootstrap token');
  const bootstrap = await fetch(`${origin}/_auth/bootstrap?token=${token}`, { redirect: 'manual' });
  assert.equal(bootstrap.status, 302);
  const setCookie = bootstrap.headers.get('set-cookie');
  assert.ok(setCookie, 'bootstrap did not issue a session cookie');
  return { child, cookie: setCookie.split(';', 1)[0] };
}

async function jsonRequest(path, cookie, init = {}, expectedStatus = 200) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
      cookie,
    },
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${init.method ?? 'GET'} ${path}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

async function install(archive, force = false) {
  run('npm', [
    'install',
    '--global',
    '--prefix',
    prefix,
    archive,
    '--omit=dev',
    '--ignore-scripts',
    ...(force ? ['--force'] : []),
  ]);
}

const fakeCodexSource = `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 0.146.0'); process.exit(0); }
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { serverInfo: { version: '0.146.0' } } });
  if (message.method === 'account/read') send({ id: message.id, result: { account: { type: 'chatgpt' } } });
});
`;

await writeFile(fakeCodex, fakeCodexSource, 'utf8');
await chmod(fakeCodex, 0o755);

let archive = process.env.MDVE_E2E_ARCHIVE;
let child;
try {
  if (!archive) {
    const releaseDir = join(tempRoot, 'release');
    await mkdir(releaseDir, { recursive: true });
    const output = execFileSync('npm', ['pack', '--pack-destination', releaseDir, '--json'], { cwd: root, encoding: 'utf8' });
    const jsonStart = output.indexOf('[\n  {');
    if (jsonStart === -1) throw new Error('npm pack did not return a JSON manifest');
    archive = join(releaseDir, JSON.parse(output.slice(jsonStart))[0].filename);
  }
  archive = resolve(archive);

  run(process.execPath, ['scripts/check-release-artifact.mjs', archive]);
  const rollbackArchive = await makeVersionedArchive(archive, rollbackVersion);
  await install(archive);
  const launcher = join(prefix, 'bin', 'mdve');
  assert.equal(await exists(launcher), true, 'global install did not create the mdve executable');

  const env = {
    ...process.env,
    MDVE_CODEX_BIN: fakeCodex,
    MDVE_HOME: dataRoot,
    MDVE_PORT: String(port),
  };
  const version = execFileSync(launcher, ['version'], { encoding: 'utf8', env });
  assert.match(version, new RegExp(`mdve ${packageJson.version}`));
  const doctorOutput = execFileSync(launcher, ['doctor', '--json'], { encoding: 'utf8', env });
  const doctor = JSON.parse(doctorOutput);
  assert.equal(doctor.mdveVersion, packageJson.version);
  assert.equal(doctor.codex.authenticated, true);
  assert.equal(doctor.codex.supported, true);
  assert.equal(await exists(dataRoot), false, 'doctor created the data directory');

  await mkdir(dataRoot, { recursive: true });
  const sentinel = join(dataRoot, 'lifecycle-sentinel.txt');
  await writeFile(sentinel, 'package lifecycle must not remove user data\n', 'utf8');

  const initialRun = await startLauncher(launcher, env);
  child = initialRun.child;
  assert.equal((await fetch(`${origin}/_mdve/ready`)).status, 200);
  assert.equal((await fetch(`${origin}/api/sessions`)).status, 401);
  const firstStartup = await jsonRequest('/api/startup', initialRun.cookie);
  await stopChild(child);
  child = undefined;

  const firstRun = await startLauncher(launcher, env);
  child = firstRun.child;
  const state = await jsonRequest(`/api/sessions/${firstStartup.session.id}`, firstRun.cookie);
  const source = 'flowchart TD\n  Start[Start] --> Release[V1 release]\n';
  const saved = await jsonRequest(`/api/sessions/${state.session.id}/diagram`, firstRun.cookie, {
    method: 'PUT',
    body: JSON.stringify({ source, expectedRevision: state.revision }),
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.historyAvailable, true);
  const conversation = await jsonRequest(`/api/sessions/${state.session.id}/conversations`, firstRun.cookie, {
    method: 'POST',
    body: JSON.stringify({ title: 'Lifecycle conversation', provider: 'codex' }),
  }, 201);
  const history = await jsonRequest(`/api/sessions/${state.session.id}/history`, firstRun.cookie);
  assert.ok(history.history.length >= 1, 'the lifecycle fixture did not create recovery history');
  const snapshot = {
    sessionId: state.session.id,
    source,
    revision: saved.revision,
    conversationId: conversation.conversation.id,
    historyCount: history.history.length,
  };
  assert.equal(await exists(join(dataRoot, 'sessions')), true);
  await stopChild(child);
  child = undefined;

  await install(archive, true);
  assert.match(execFileSync(launcher, ['version'], { encoding: 'utf8', env }), new RegExp(`mdve ${packageJson.version}`));
  const reinstallRun = await startLauncher(launcher, env);
  child = reinstallRun.child;
  const afterReinstall = await jsonRequest(`/api/sessions/${snapshot.sessionId}`, reinstallRun.cookie);
  assert.equal(afterReinstall.source, snapshot.source, 'same-version reinstall changed the Diagram source');
  assert.equal(afterReinstall.revision, snapshot.revision, 'same-version reinstall changed the revision');
  await stopChild(child);
  child = undefined;

  await install(rollbackArchive, true);
  assert.match(execFileSync(launcher, ['version'], { encoding: 'utf8', env }), new RegExp(`mdve ${rollbackVersion}`));
  const rollbackRun = await startLauncher(launcher, env);
  child = rollbackRun.child;
  const afterRollback = await jsonRequest(`/api/sessions/${snapshot.sessionId}`, rollbackRun.cookie);
  const rollbackHistory = await jsonRequest(`/api/sessions/${snapshot.sessionId}/history`, rollbackRun.cookie);
  const rollbackConversations = await jsonRequest(`/api/sessions/${snapshot.sessionId}/conversations`, rollbackRun.cookie);
  assert.equal(afterRollback.source, snapshot.source, 'versioned rollback changed the Diagram source');
  assert.equal(afterRollback.revision, snapshot.revision, 'versioned rollback changed the revision');
  assert.ok(rollbackHistory.history.length >= snapshot.historyCount, 'versioned rollback lost recovery history');
  assert.ok(rollbackConversations.conversations.some((item) => item.id === snapshot.conversationId), 'versioned rollback lost the Conversation');
  await stopChild(child);
  child = undefined;

  await install(archive, true);
  assert.match(execFileSync(launcher, ['version'], { encoding: 'utf8', env }), new RegExp(`mdve ${packageJson.version}`));
  const updateRun = await startLauncher(launcher, env);
  child = updateRun.child;
  const afterUpdate = await jsonRequest(`/api/sessions/${snapshot.sessionId}`, updateRun.cookie);
  assert.equal(afterUpdate.source, snapshot.source, 'returning to the release candidate changed the Diagram source');
  assert.equal(afterUpdate.revision, snapshot.revision, 'returning to the release candidate changed the revision');
  await stopChild(child);
  child = undefined;

  const metaPath = join(dataRoot, 'sessions', snapshot.sessionId, 'session.json');
  const supportedMeta = await readFile(metaPath, 'utf8');
  const incompatibleMeta = { ...JSON.parse(supportedMeta), schemaVersion: 2 };
  await writeFile(metaPath, `${JSON.stringify(incompatibleMeta, null, 2)}\n`, 'utf8');
  const incompatibleRun = await startLauncher(launcher, env);
  child = incompatibleRun.child;
  const incompatibleResponse = await jsonRequest(`/api/sessions/${snapshot.sessionId}`, incompatibleRun.cookie, {}, 409);
  assert.equal(incompatibleResponse.schemaVersion, 2);
  assert.equal(incompatibleResponse.supportedSchemaVersion, 1);
  assert.match(incompatibleResponse.error, /refusing to write/);
  assert.equal(await readFile(metaPath, 'utf8'), `${JSON.stringify(incompatibleMeta, null, 2)}\n`, 'incompatible schema was rewritten');
  await stopChild(child);
  child = undefined;
  await writeFile(metaPath, supportedMeta, 'utf8');

  run('npm', ['uninstall', '--global', '--prefix', prefix, packageJson.name]);
  assert.equal(await exists(launcher), false, 'uninstall left the mdve executable behind');
  assert.equal(await readFile(sentinel, 'utf8'), 'package lifecycle must not remove user data\n');
  assert.equal(await exists(join(dataRoot, 'sessions', snapshot.sessionId, 'diagram.mmd')), true, 'uninstall removed Diagram data');
  const evidence = {
    archive,
    version: packageJson.version,
    rollbackArchive,
    rollbackVersion,
    globalPrefix: prefix,
    dataRetained: true,
    sameVersionReinstallRetained: true,
    versionedRollbackRetained: true,
    reinstallRetained: true,
    conversationRetained: true,
    historyRetained: true,
    incompatibleSchemaReadOnly: true,
    incompatibleSchemaVersion: 2,
    previousStable: null,
    rollbackImplementation: 'same candidate bytes with package version metadata rewritten for lifecycle retention testing; no separately published previous stable exists yet',
  };
  if (process.env.MDVE_LIFECYCLE_OUTPUT) {
    await writeFile(process.env.MDVE_LIFECYCLE_OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (child && child.exitCode === null) await stopChild(child);
  await rm(tempRoot, { recursive: true, force: true });
}
