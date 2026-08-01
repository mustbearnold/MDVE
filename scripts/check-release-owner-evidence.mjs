import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_GATES = {
  manualAccessibility: {
    status: 'passed',
    fields: ['artifact', 'tester', 'date'],
  },
  liveCodex: {
    status: 'passed',
    fields: ['artifact', 'tester', 'runtime', 'date'],
  },
  legal: {
    status: 'approved',
    fields: ['reference', 'approver', 'date'],
  },
  registryName: {
    status: 'available',
    fields: ['package', 'reference', 'checkedAt'],
  },
  previousStable: {
    status: 'verified',
    fields: ['version', 'integrity', 'artifact'],
  },
  lifecycle: {
    status: 'verified',
    fields: ['artifact', 'checkedAt'],
  },
};

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireCommit(value, label) {
  requireString(value, label);
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error(`${label} must be a full Git commit SHA`);
}

function requireIntegrity(value, label) {
  requireString(value, label);
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} must be an npm SHA-512 integrity value`);
  }
}

export function validateReleaseOwnerEvidence(evidence, expected) {
  requireObject(evidence, 'release-owner evidence');
  requireObject(expected, 'expected release identity');
  requireCommit(expected.commit, 'expected release identity commit');
  requireString(expected.packageName, 'expected release package name');
  requireString(expected.version, 'expected release package version');

  if (evidence.schemaVersion !== 1) throw new Error('release-owner evidence schemaVersion must be 1');
  requireCommit(evidence.candidateCommit, 'candidateCommit');
  if (evidence.candidateCommit !== expected.commit) {
    throw new Error(`candidateCommit ${evidence.candidateCommit} does not match ${expected.commit}`);
  }
  requireString(evidence.packageVersion, 'packageVersion');
  if (evidence.packageVersion !== expected.version) {
    throw new Error(`packageVersion ${evidence.packageVersion} does not match ${expected.version}`);
  }
  requireString(evidence.releaseOwner, 'releaseOwner');
  requireString(evidence.attestedAt, 'attestedAt');

  for (const [gate, requirements] of Object.entries(REQUIRED_GATES)) {
    const record = evidence[gate];
    requireObject(record, gate);
    if (record.status !== requirements.status) {
      throw new Error(`${gate}.status must be ${requirements.status}`);
    }
    for (const field of requirements.fields) requireString(record[field], `${gate}.${field}`);
  }

  if (evidence.registryName.package !== expected.packageName) {
    throw new Error(`registryName.package must be ${expected.packageName}`);
  }
  if (evidence.previousStable.version === expected.version) {
    throw new Error('previousStable.version must identify a separately built version');
  }
  requireIntegrity(evidence.previousStable.integrity, 'previousStable.integrity');

  return {
    schemaVersion: evidence.schemaVersion,
    candidateCommit: evidence.candidateCommit,
    packageVersion: evidence.packageVersion,
    releaseOwner: evidence.releaseOwner,
    attestedAt: evidence.attestedAt,
    gates: Object.fromEntries(Object.keys(REQUIRED_GATES).map((gate) => [gate, evidence[gate].status])),
  };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const evidencePath = process.argv[2];
  if (!evidencePath) throw new Error('Usage: node scripts/check-release-owner-evidence.mjs <evidence.json>');

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const commit = process.env.MDVE_RELEASE_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const summary = validateReleaseOwnerEvidence(evidence, {
    commit,
    packageName: packageJson.name,
    version: process.env.MDVE_RELEASE_VERSION ?? packageJson.version,
  });
  console.log(JSON.stringify(summary, null, 2));
}
