import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const archive = process.argv[2];
const outputPath = process.argv[3];
if (!archive) throw new Error('Usage: node scripts/check-registry-candidate.mjs <local-tarball> [output]');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const localBytes = readFileSync(archive);
const localSha256 = createHash('sha256').update(localBytes).digest('hex');
const localIntegrity = `sha512-${createHash('sha512').update(localBytes).digest('base64')}`;
const registrySpec = `${packageJson.name}@${packageJson.version}`;
const registry = JSON.parse(execFileSync('npm', ['view', registrySpec, '--json'], { encoding: 'utf8' }));
assert.equal(registry?.dist?.integrity, localIntegrity, `registry integrity does not match ${localIntegrity}`);

const tempRoot = mkdtempSync(join(tmpdir(), 'mdve-registry-smoke-'));
try {
  const packed = execFileSync('npm', ['pack', registrySpec, '--ignore-scripts', '--pack-destination', tempRoot, '--json'], { encoding: 'utf8' });
  const jsonStart = packed.indexOf('[\n  {');
  if (jsonStart === -1) throw new Error('npm pack did not return a JSON manifest for the registry package');
  const downloaded = join(tempRoot, JSON.parse(packed.slice(jsonStart))[0].filename);
  const downloadedBytes = readFileSync(downloaded);
  assert.deepEqual(downloadedBytes, localBytes, 'registry tarball bytes differ from the tested candidate');

  const smokePrefix = join(tempRoot, 'prefix');
  execFileSync('npm', ['install', '--prefix', smokePrefix, '--omit=dev', '--ignore-scripts', registrySpec], { stdio: 'inherit' });
  const launcher = join(smokePrefix, 'node_modules', '.bin', 'mdve');
  const version = execFileSync(launcher, ['version'], { encoding: 'utf8' });
  assert.match(version, new RegExp(`mdve ${packageJson.version}`));
  execFileSync('npm', ['audit', 'signatures', '--prefix', smokePrefix], { stdio: 'inherit' });

  const evidence = {
    package: packageJson.name,
    version: packageJson.version,
    registrySpec,
    localSha256,
    localIntegrity,
    registryIntegrity: registry.dist.integrity,
    registryShasum: registry.dist.shasum ?? null,
    exactBytes: true,
    cleanPrefixLaunch: true,
    registrySignatures: true,
  };
  if (outputPath) writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
