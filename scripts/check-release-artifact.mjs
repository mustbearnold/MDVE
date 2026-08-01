import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const candidate = process.argv[2];

function packagePathsFromArchive(path) {
  return execFileSync('tar', ['-tzf', path], { encoding: 'utf8' })
    .split('\n')
    .map((entry) => entry.replace(/^package\//, '').replace(/\/$/, ''))
    .filter(Boolean);
}

function packagePathsFromDryRun() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
  const jsonStart = output.indexOf('[');
  if (jsonStart === -1) throw new Error('npm pack did not return a JSON manifest');
  const manifest = JSON.parse(output.slice(jsonStart));
  return manifest[0].files.map((file) => file.path);
}

function archiveEntryBytes(path, entry) {
  return execFileSync('tar', ['-xOzf', path, `package/${entry}`]);
}

const paths = candidate ? packagePathsFromArchive(candidate) : packagePathsFromDryRun();
const forbidden = /(^|\/)(\.scratch|\.agents|\.github|node_modules|server\/src|web\/src)(\/|$)|\.map$/;
const required = ['package.json', 'README.md', 'LICENSE.md', 'NOTICE.md', 'bin/mdve.mjs', 'dist/web/index.html', 'dist/server/index.js'];
const unexpected = paths.filter((path) => forbidden.test(path));
const missing = required.filter((path) => !paths.includes(path));

if (unexpected.length > 0) throw new Error(`Release artifact contains forbidden paths: ${unexpected.join(', ')}`);
if (missing.length > 0) throw new Error(`Release artifact is missing required paths: ${missing.join(', ')}`);
if (paths.some((path) => path.startsWith('dist/') === false && !required.includes(path))) {
  const unexpectedTopLevel = paths.filter((path) => path.startsWith('dist/') === false && !required.includes(path));
  throw new Error(`Release artifact contains unexpected paths: ${unexpectedTopLevel.join(', ')}`);
}

const initialChunk = readdirSync(join(process.cwd(), 'dist/web/assets')).find((name) => /^index-.*\.js$/.test(name));
if (!initialChunk) throw new Error('Could not find the initial application JavaScript chunk');
const initialBytes = statSync(join(process.cwd(), 'dist/web/assets', initialChunk)).size;
if (initialBytes > 500_000) throw new Error(`Initial application chunk is ${initialBytes} bytes; limit is 500000`);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.private) throw new Error('Release package must not be private');
if (packageJson.bin?.mdve !== 'bin/mdve.mjs') throw new Error('Release package must expose bin/mdve.mjs as the mdve executable');
if (packageJson.engines?.node !== '^22.11.0 || ^24.11.0') throw new Error('Release package has an unexpected Node support range');
if (packageJson.repository?.url !== 'git+https://github.com/mustbearnold/MDVE.git') throw new Error('Release package repository metadata is not canonical');

const archiveBytes = candidate ? readFileSync(candidate) : undefined;
const sha256 = archiveBytes ? createHash('sha256').update(archiveBytes).digest('hex') : null;
const sha512 = archiveBytes ? createHash('sha512').update(archiveBytes).digest('base64') : null;
const archiveInitial = candidate
  ? paths.find((path) => /^dist\/web\/assets\/index-.*\.js$/.test(path))
  : undefined;
if (candidate && !archiveInitial) throw new Error('Release artifact is missing the initial application JavaScript chunk');
const exactInitialBytes = archiveInitial ? archiveEntryBytes(candidate, archiveInitial).byteLength : initialBytes;
if (exactInitialBytes > 500_000) throw new Error(`Initial application chunk is ${exactInitialBytes} bytes; limit is 500000`);

console.log(JSON.stringify({
  candidate: candidate ?? 'npm pack --dry-run',
  version: packageJson.version,
  files: paths.length,
  bytes: archiveBytes?.byteLength ?? null,
  sha256,
  initialChunk: archiveInitial ?? initialChunk,
  initialBytes: exactInitialBytes,
  integrity: sha512 ? `sha512-${sha512}` : null,
}, null, 2));
