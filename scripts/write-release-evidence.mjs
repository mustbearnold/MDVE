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
const commandVersion = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const nodeVersion = process.versions.node;
const candidateCommit = git(['rev-parse', 'HEAD']);
const lockfileSha256 = createHash('sha256').update(lockfile).digest('hex');
const tarballSha256 = createHash('sha256').update(tarball).digest('hex');
const tarballSha512 = createHash('sha512').update(tarball).digest('base64');
const status = git(['status', '--porcelain']);
const tarListing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .split('\n')
  .map((entry) => entry.replace(/^package\//, '').replace(/\/$/, ''))
  .filter(Boolean);
const performancePath = process.env.MDVE_PERFORMANCE_OUTPUT ?? 'release/performance.json';
const stabilityPath = process.env.MDVE_STABILITY_SUMMARY ?? 'test-results/release-stability/summary.json';
const lifecyclePath = process.env.MDVE_LIFECYCLE_OUTPUT ?? 'release/lifecycle.json';
const processCrashPath = process.env.MDVE_PROCESS_CRASH_OUTPUT ?? 'test-results/process-crash.json';
const codexSchemaPath = process.env.MDVE_CODEX_SCHEMA_OUTPUT ?? 'test-results/codex-schema.json';
const registryPath = process.env.MDVE_REGISTRY_EVIDENCE ?? 'release/registry.json';
const sourceVisibility = process.env.MDVE_SOURCE_VISIBILITY ?? 'public';
const registryEvidence = await readOptional(registryPath);
const stabilityEvidence = await readOptional(stabilityPath);
if (stabilityEvidence && stabilityEvidence.commit !== candidateCommit) {
  throw new Error(`stability evidence commit ${stabilityEvidence.commit ?? 'missing'} does not match candidate ${candidateCommit}`);
}

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
    commit: candidateCommit,
    branch: git(['branch', '--show-current']),
    tag: commandVersion('git', ['describe', '--exact-match', '--tags', 'HEAD']),
    cleanTree: status.length === 0,
    package: packageJson.name,
    version: packageJson.version,
    tarball: basename(archive),
    bytes: tarball.byteLength,
    sha256: tarballSha256,
    integrity: `sha512-${tarballSha512}`,
    lockfileSha256,
    lockfileSha512: createHash('sha512').update(lockfile).digest('hex'),
  },
  environment: {
    node: nodeVersion,
    npm: npmVersion,
    platform: process.platform,
    arch: process.arch,
    uname: execFileSync('uname', ['-a'], { encoding: 'utf8' }).trim(),
    chromium: commandVersion('chromium', ['--version']),
    firefox: commandVersion('firefox', ['--version']),
    codex: commandVersion(process.env.MDVE_CODEX_BIN ?? 'codex', ['--version']),
  },
  artifact: {
    files: tarListing,
    fileCount: tarListing.length,
  },
  automatedEvidence: {
    performance: await readOptional(performancePath),
    stability: stabilityEvidence,
    lifecycle: await readOptional(lifecyclePath),
    processCrash: await readOptional(processCrashPath),
    codexSchema: await readOptional(codexSchemaPath),
  },
  releaseRecord: {
    githubRun: process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    registry: registryEvidence ?? 'not published by this evidence command',
    trustedPublisher: process.env.MDVE_TRUSTED_PUBLISHER ?? 'not verified by this evidence command',
    sourceVisibility,
    publicSourceProvenance: sourceVisibility === 'private'
      ? 'unavailable for a package built from private GitHub source'
      : 'not verified by this evidence command; verify the npm attestation after trusted publication',
  },
  limitations: [
    'Manual WCAG 2.2 AA keyboard, zoom, forced-colors, and Orca results require a release-owner record.',
    'Live authenticated Codex compatibility and qualified legal approval are external release gates.',
    sourceVisibility === 'private'
      ? 'Private GitHub source cannot produce a public npm provenance claim.'
      : 'Public-source npm provenance remains unverified until the trusted-publishing workflow publishes and the registry attestation is checked.',
    'The lifecycle rollback fixture rewrites package metadata from this candidate; it is not evidence against a separately built previous stable or incompatible data schema.',
  ],
};

await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, commit: evidence.candidate.commit, integrity: evidence.candidate.integrity }, null, 2));
