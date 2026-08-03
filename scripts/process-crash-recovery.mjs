import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tempRoot = await mkdtemp(join(tmpdir(), 'mdve-process-crash-'));
const prefix = join(tempRoot, 'prefix');
const archive = process.env.MDVE_E2E_ARCHIVE ? resolve(process.env.MDVE_E2E_ARCHIVE) : null;
let serverPath = join(root, 'dist', 'server', 'index.js');
const outputPath = process.env.MDVE_PROCESS_CRASH_OUTPUT ?? join(root, 'test-results', 'process-crash.json');

const baselineSource = 'flowchart TD\n  start[Start] --> stable[Stable revision]\n';
const successorSource = 'flowchart LR\n  start[Start] --> recovered[Recovered revision]\n';
const cases = [
  { name: 'before-diagram-rename', crashAt: 'rename:diagram.mmd', expected: 'old' },
  { name: 'after-diagram-rename', crashAt: 'after-rename:diagram.mmd', expected: 'old' },
  { name: 'after-revision-rename', crashAt: 'after-rename:revision.json', expected: 'new' },
];

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Could not reserve a local port'));
        return;
      }
      probe.close(() => resolvePort(address.port));
    });
  });
}

async function listTemporaryFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTemporaryFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.tmp')) files.push(path);
  }
  return files;
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return await Promise.race([
    once(child, 'exit').then(([code, signal]) => ({ code, signal })),
    new Promise((_, reject) => setTimeout(() => reject(new Error('crashed server did not exit')), timeoutMs)),
  ]);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 2_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child).catch(() => undefined);
  }
}

async function startServer(dataRoot, port, crashAt = '') {
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      MDVE_HOME: dataRoot,
      MDVE_HOST: '127.0.0.1',
      MDVE_PORT: String(port),
      MDVE_AUTH_REQUIRED: '0',
      MDVE_VERSION: '3.0.0',
      ...(crashAt ? { MDVE_DURABILITY_CRASH: crashAt } : { MDVE_DURABILITY_CRASH: '' }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`MDVE exited before ready: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/_mdve/ready`);
      if (response.ok) return { child, output: () => output };
    } catch {
      /* keep polling */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  throw new Error(`MDVE did not become ready: ${output}`);
}

async function jsonRequest(port, path, init = {}, expectedStatus = 200) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${init.method ?? 'GET'} ${path}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

function sha256(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

const evidence = [];
try {
  if (archive) {
    execFileSync('npm', ['install', '--prefix', prefix, archive, '--omit=dev', '--ignore-scripts'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_cache: join(tempRoot, 'npm-cache'),
        npm_config_logs_dir: join(tempRoot, 'npm-logs'),
      },
    });
    serverPath = join(prefix, 'node_modules', packageJson.name, 'dist', 'server', 'index.js');
  }
  const packageStat = await stat(serverPath);
  assert.ok(packageStat.isFile(), `built server is missing at ${serverPath}`);
  await mkdir(join(outputPath, '..'), { recursive: true });

  for (const testCase of cases) {
    const dataRoot = join(tempRoot, testCase.name);
    const port = await freePort();
    let running;
    try {
      running = await startServer(dataRoot, port);
      const created = await jsonRequest(port, '/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: `Crash ${testCase.name}`, source: baselineSource }),
      }, 201);
      const sessionId = created.session.id;
      await stopServer(running.child);
      running = undefined;

      running = await startServer(dataRoot, port, testCase.crashAt);
      try {
        await jsonRequest(port, `/api/sessions/${sessionId}/diagram`, {
          method: 'PUT',
          body: JSON.stringify({ source: successorSource, expectedRevision: 1 }),
        });
      } catch {
        /* The expected SIGKILL usually closes fetch before it has an HTTP response. */
      }
      const crashOutput = running.output();
      const exit = await waitForExit(running.child);
      assert.equal(exit.signal, 'SIGKILL', `${testCase.name} did not simulate a process crash: ${crashOutput}`);
      const temporaryFilesBeforeRestart = await listTemporaryFiles(dataRoot);
      running = undefined;

      running = await startServer(dataRoot, port);
      const recovered = await jsonRequest(port, `/api/sessions/${sessionId}`);
      const persistedSource = await readFile(join(dataRoot, 'sessions', sessionId, 'diagram.mmd'), 'utf8');
      const persistedRevision = JSON.parse(await readFile(join(dataRoot, 'sessions', sessionId, 'revision.json'), 'utf8'));
      const expectedSource = testCase.expected === 'new' ? successorSource : baselineSource;
      const expectedRevision = testCase.expected === 'new' ? 2 : 1;
      assert.equal(recovered.source, expectedSource, `${testCase.name} returned a mixed revision`);
      assert.equal(recovered.revision, expectedRevision, `${testCase.name} returned an unexpected revision`);
      assert.equal(recovered.checksum, sha256(recovered.source), `${testCase.name} returned a bad checksum`);
      assert.equal(persistedSource, expectedSource, `${testCase.name} persisted a mixed source`);
      assert.equal(persistedRevision.revision, expectedRevision, `${testCase.name} persisted an unexpected revision`);
      assert.equal(persistedRevision.checksum, sha256(persistedSource), `${testCase.name} persisted a bad checksum`);
      const temporaryFilesAfterRestart = await listTemporaryFiles(dataRoot);
      assert.equal(temporaryFilesAfterRestart.length, 0, `${testCase.name} left temporary durability files after restart`);
      if (temporaryFilesBeforeRestart.length > 0) {
        assert.match(running.output(), /removed \d+ abandoned temporary durability file/, `${testCase.name} did not diagnose cleanup`);
      }
      evidence.push({
        name: testCase.name,
        crashAt: testCase.crashAt,
        acceptedRevision: testCase.expected,
        temporaryFilesBeforeRestart: temporaryFilesBeforeRestart.length,
        temporaryFilesAfterRestart: temporaryFilesAfterRestart.length,
        recoveryLog: running.output().includes('repaired an unacknowledged diagram write'),
      });
    } finally {
      if (running) await stopServer(running.child);
    }
  }

  const result = {
    schemaVersion: 1,
    platform: process.platform,
    node: process.versions.node,
    cases: evidence,
    passed: evidence.length === cases.length,
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
