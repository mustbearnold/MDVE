import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tempRoot = await mkdtemp(join(tmpdir(), 'mdve-install-lifecycle-'));
const prefix = join(tempRoot, 'global');
const dataRoot = join(tempRoot, 'data');
const fakeCodex = join(tempRoot, 'codex');
const port = 4192;

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

const fakeCodexSource = `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 0.146.0'); process.exit(0); }
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'account/read') send({ id: message.id, result: { account: { type: 'chatgpt', email: 'lifecycle@example.test' } } });
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

  run(process.execPath, ['scripts/check-release-artifact.mjs', archive]);
  run('npm', ['install', '--global', '--prefix', prefix, archive, '--omit=dev', '--ignore-scripts']);
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
  child = spawn(launcher, ['--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 15_000;
  while (!output.includes('MDVE is ready at') && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`launcher exited before ready: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(output, /MDVE is ready at http:\/\/127\.0\.0\.1:4192/);
  assert.match(output, /_auth\/bootstrap\?token=[0-9a-f]+/);
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${origin}/_mdve/ready`)).status, 200);
  assert.equal((await fetch(`${origin}/api/sessions`)).status, 401);
  const bootstrap = await fetch(`${origin}/_auth/bootstrap?token=${output.match(/_auth\/bootstrap\?token=([0-9a-f]+)/)[1]}`, { redirect: 'manual' });
  assert.equal(bootstrap.status, 302);
  const setCookie = bootstrap.headers.get('set-cookie');
  assert.ok(setCookie);
  const startup = await fetch(`${origin}/api/startup`, { headers: { cookie: setCookie.split(';', 1)[0] } });
  assert.equal(startup.status, 200);

  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
  child = undefined;
  run('npm', ['uninstall', '--global', '--prefix', prefix, packageJson.name]);
  assert.equal(await exists(launcher), false, 'uninstall left the mdve executable behind');
  assert.equal(await readFile(sentinel, 'utf8'), 'package lifecycle must not remove user data\n');
  console.log(JSON.stringify({ archive, version: packageJson.version, globalPrefix: prefix, dataRetained: true }, null, 2));
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await rm(tempRoot, { recursive: true, force: true });
}
