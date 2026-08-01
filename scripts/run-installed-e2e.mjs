import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8'));
const tempRoot = mkdtempSync(join(tmpdir(), 'mdve-installed-e2e-'));
const prefix = join(tempRoot, 'prefix');
const dataRoot = join(tempRoot, 'data');

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

let archive = process.env.MDVE_E2E_ARCHIVE;
if (!archive) {
  const releaseDir = join(tempRoot, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const output = execFileSync('npm', ['pack', '--pack-destination', releaseDir, '--json'], { cwd: root, encoding: 'utf8' });
  const jsonStart = output.indexOf('[\n  {');
  if (jsonStart === -1) throw new Error('npm pack did not return a JSON manifest');
  const manifest = JSON.parse(output.slice(jsonStart));
  archive = manifest[0].filename;
  archive = join(releaseDir, archive);
}

run(process.execPath, ['scripts/check-release-artifact.mjs', archive]);
run('npm', ['install', '--prefix', prefix, archive, '--omit=dev', '--ignore-scripts']);

const installedRoot = join(prefix, 'node_modules', packageJson.name);
const server = join(installedRoot, 'dist', 'server', 'index.js');
const webDist = join(installedRoot, 'dist', 'web');
const serverCommand = [
  `MDVE_HOME=${shellQuote(dataRoot)}`,
  'MDVE_HOST=127.0.0.1',
  'MDVE_PORT=4187',
  'MDVE_AUTH_REQUIRED=0',
  `MDVE_VERSION=${shellQuote(packageJson.version)}`,
  `MDVE_WEB_DIST=${shellQuote(webDist)}`,
  `${shellQuote(process.execPath)} ${shellQuote(server)}`,
].join(' ');

run('npm', ['run', 'test:e2e'], {
  env: {
    ...process.env,
    MDVE_E2E_SERVER_COMMAND: serverCommand,
  },
});

console.log(JSON.stringify({ archive, installedRoot, version: packageJson.version }, null, 2));
