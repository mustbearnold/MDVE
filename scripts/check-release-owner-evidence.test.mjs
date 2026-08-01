import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseOwnerEvidence } from './check-release-owner-evidence.mjs';

const expected = {
  commit: 'a'.repeat(40),
  packageName: 'mdve',
  version: '1.0.0',
};

function validEvidence() {
  return {
    schemaVersion: 1,
    candidateCommit: expected.commit,
    packageVersion: expected.version,
    releaseOwner: 'release-owner',
    attestedAt: '2026-08-02T00:00:00Z',
    manualAccessibility: { status: 'passed', artifact: 'accessibility.md', tester: 'tester', date: '2026-08-02' },
    liveCodex: { status: 'passed', artifact: 'codex.md', tester: 'tester', runtime: '0.146.0', date: '2026-08-02' },
    legal: { status: 'approved', reference: 'counsel-approval', approver: 'counsel', date: '2026-08-02' },
    registryName: { status: 'available', package: expected.packageName, reference: 'npm-check', checkedAt: '2026-08-02' },
    previousStable: { status: 'verified', version: '0.9.0', integrity: 'sha512-' + 'A'.repeat(86), artifact: 'previous.tgz' },
    lifecycle: { status: 'verified', artifact: 'lifecycle.json', checkedAt: '2026-08-02' },
  };
}

test('accepts a complete candidate-bound release-owner record', () => {
  const summary = validateReleaseOwnerEvidence(validEvidence(), expected);
  assert.deepEqual(summary.gates, {
    manualAccessibility: 'passed',
    liveCodex: 'passed',
    legal: 'approved',
    registryName: 'available',
    previousStable: 'verified',
    lifecycle: 'verified',
  });
});

test('rejects a record from another candidate', () => {
  const evidence = validEvidence();
  evidence.candidateCommit = 'b'.repeat(40);
  assert.throws(() => validateReleaseOwnerEvidence(evidence, expected), /does not match/);
});

test('rejects using the release candidate as the previous stable', () => {
  const evidence = validEvidence();
  evidence.previousStable.version = expected.version;
  assert.throws(() => validateReleaseOwnerEvidence(evidence, expected), /separately built version/);
});
