import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const runs = Number(process.env.MDVE_STABILITY_RUNS ?? 10);
const outputRoot = join(root, process.env.MDVE_STABILITY_OUTPUT ?? 'test-results/release-stability');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
  ['unit-contract', ['test']],
  ['browser', ['run', 'test:e2e']],
  ['reliability', ['run', 'test:reliability']],
  ['install-lifecycle', ['run', 'test:install:lifecycle']],
];

if (!Number.isInteger(runs) || runs < 1) throw new Error('MDVE_STABILITY_RUNS must be a positive integer');
await mkdir(outputRoot, { recursive: true });

const startedAt = new Date().toISOString();
const results = [];
let failed = false;

for (let run = 1; run <= runs; run += 1) {
  for (const [name, args] of commands) {
    const runStarted = Date.now();
    const reportDir = join(outputRoot, `run-${String(run).padStart(2, '0')}`);
    await mkdir(reportDir, { recursive: true });
    const env = {
      ...process.env,
      MDVE_E2E_REPORT: join(reportDir, 'e2e-results.json'),
    };
    const result = spawnSync(npm, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    await writeFile(join(reportDir, `${name}.log`), output, 'utf8');
    process.stdout.write(output);
    const record = {
      run,
      suite: name,
      command: [npm, ...args].join(' '),
      status: result.status === 0 ? 'passed' : 'failed',
      signal: result.signal,
      durationMs: Date.now() - runStarted,
    };
    results.push(record);
    console.log(JSON.stringify(record));
    if (record.status !== 'passed') {
      failed = true;
      break;
    }
  }
  if (failed) break;
}

const summary = {
  schemaVersion: 1,
  startedAt,
  completedAt: new Date().toISOString(),
  requestedRuns: runs,
  completedRuns: new Set(results.map((result) => result.run)).size,
  suites: commands.map(([name]) => name),
  passed: !failed && results.length === runs * commands.length,
  results,
};
await writeFile(join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ stability: summary }, null, 2));
if (!summary.passed) process.exitCode = 1;
