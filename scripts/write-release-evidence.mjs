import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const archive = process.argv[2];
const output = process.argv[3] ?? 'release/evidence.json';
if (!archive) throw new Error('Usage: node scripts/write-release-evidence.mjs <tarball> [output]');

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const lockfile = await readFile('package-lock.json');
const tarball = await readFile(archive);
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const nodeVersion = process.versions.node;
const tarListing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .split('\n')
  .map((entry) => entry.replace(/^package\//, '').replace(/\/$/, ''))
  .filter(Boolean);
const performancePath = process.env.MDVE_PERFORMANCE_OUTPUT ?? 'release/performance.json';
const stabilityPath = process.env.MDVE_STABILITY_SUMMARY ?? 'test-results/release-stability/summary.json';

async function readOptional(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  candidate: {
    commit: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    package: packageJson.name,
    version: packageJson.version,
    tarball: basename(archive),
    integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
    lockfileSha512: createHash('sha512').update(lockfile).digest('hex'),
  },
  environment: {
    node: nodeVersion,
    npm: npmVersion,
    platform: process.platform,
    arch: process.arch,
    uname: execFileSync('uname', ['-a'], { encoding: 'utf8' }).trim(),
  },
  artifact: {
    files: tarListing,
    fileCount: tarListing.length,
  },
  automatedEvidence: {
    performance: await readOptional(performancePath),
    stability: await readOptional(stabilityPath),
  },
  limitations: [
    'Manual WCAG 2.2 AA keyboard, zoom, forced-colors, and Orca results require a release-owner record.',
    'Live authenticated Codex compatibility and qualified legal approval are external release gates.',
    'Private GitHub source cannot produce a public npm provenance claim.',
  ],
};

await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, commit: evidence.candidate.commit, integrity: evidence.candidate.integrity }, null, 2));
