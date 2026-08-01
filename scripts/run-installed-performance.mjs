import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tempRoot = mkdtempSync(join(tmpdir(), 'mdve-performance-'));
const prefix = join(tempRoot, 'prefix');
const dataRoot = join(tempRoot, 'data');
const outputPath = resolve(process.env.MDVE_PERFORMANCE_OUTPUT ?? join(root, 'test-results', 'performance.json'));
mkdirSync(join(outputPath, '..'), { recursive: true });

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
  archive = join(releaseDir, JSON.parse(output.slice(jsonStart))[0].filename);
}

run(process.execPath, ['scripts/check-release-artifact.mjs', archive]);
run('npm', ['install', '--prefix', prefix, archive, '--omit=dev', '--ignore-scripts']);

const installedRoot = join(prefix, 'node_modules', packageJson.name);
const server = join(installedRoot, 'dist', 'server', 'index.js');
const webDist = join(installedRoot, 'dist', 'web');
const port = 4191;
const serverCommand = [
  `MDVE_HOME=${shellQuote(dataRoot)}`,
  'MDVE_HOST=127.0.0.1',
  `MDVE_PORT=${port}`,
  'MDVE_AUTH_REQUIRED=0',
  `MDVE_VERSION=${shellQuote(packageJson.version)}`,
  `MDVE_WEB_DIST=${shellQuote(webDist)}`,
  `${shellQuote(process.execPath)} ${shellQuote(server)}`,
].join(' ');

const child = spawn('sh', ['-c', serverCommand], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/_mdve/ready`);
      if (response.ok) return;
    } catch {
      /* keep polling */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`performance server did not become ready: ${serverOutput}`);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

const samples = [];
const browser = await chromium.launch({ headless: true });
try {
  await waitForServer();
  for (let index = 0; index < 20; index += 1) {
    const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const state = { lcp: null, cls: 0, tbt: 0 };
      window.__mdvePerformance = state;
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries.at(-1);
          if (last) state.lcp = last.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {}
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) state.cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) state.tbt += Math.max(0, entry.duration - 50);
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
    });

    const navigationStarted = performance.now();
    const response = await page.request.post(`http://127.0.0.1:${port}/api/sessions`, {
      data: { title: `Performance ${index}` },
    });
    assert.equal(response.ok(), true);
    const session = (await response.json()).session;
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate((id) => localStorage.setItem('mdve.session', id), session.id);
    await page.reload();
    await page.getByRole('heading', { name: 'Preview' }).waitFor();
    await page.getByText('Saved · revision 1').waitFor();
    const usableMs = performance.now() - navigationStarted;

    const editStarted = performance.now();
    await page.getByRole('button', { name: 'Source' }).click();
    await page.getByRole('textbox', { name: 'Mermaid source' }).fill(`flowchart TD\n  start[Start] --> n${index}[Node ${index}]\n`);
    await page.getByText('Saved · revision 2').waitFor();
    const editToSavedMs = performance.now() - editStarted;
    await page.waitForTimeout(50);
    const metrics = await page.evaluate(() => ({ ...window.__mdvePerformance }));
    samples.push({ index, usableMs, editToSavedMs, lcpMs: metrics.lcp, cls: metrics.cls, tbtMs: metrics.tbt });
    await context.close();
  }
} finally {
  await browser.close();
  child.kill('SIGTERM');
}

const usable = samples.map((sample) => sample.usableMs);
const saved = samples.map((sample) => sample.editToSavedMs);
const lcp = samples.map((sample) => sample.lcpMs).filter((value) => typeof value === 'number');
const cls = samples.map((sample) => sample.cls);
const tbt = samples.map((sample) => sample.tbtMs);
const summary = {
  archive,
  version: packageJson.version,
  samples,
  budgets: {
    usableP75Ms: percentile(usable, 0.75),
    usableP95Ms: percentile(usable, 0.95),
    savedP75Ms: percentile(saved, 0.75),
    savedP95Ms: percentile(saved, 0.95),
    lcpP75Ms: lcp.length === samples.length ? percentile(lcp, 0.75) : null,
    clsP75: percentile(cls, 0.75),
    tbtP75Ms: percentile(tbt, 0.75),
  },
};
assert.equal(samples.length, 20);
assert.equal(lcp.length, samples.length, 'LCP was not measured for every cold navigation');
assert.ok(summary.budgets.usableP75Ms <= 2_000, `usable p75 ${summary.budgets.usableP75Ms}ms exceeded 2000ms`);
assert.ok(summary.budgets.usableP95Ms <= 3_000, `usable p95 ${summary.budgets.usableP95Ms}ms exceeded 3000ms`);
assert.ok(summary.budgets.lcpP75Ms <= 2_500, `LCP p75 ${summary.budgets.lcpP75Ms}ms exceeded 2500ms`);
assert.ok(summary.budgets.clsP75 <= 0.1, `CLS p75 ${summary.budgets.clsP75} exceeded 0.1`);
assert.ok(summary.budgets.tbtP75Ms <= 200, `TBT p75 ${summary.budgets.tbtP75Ms}ms exceeded 200ms`);
assert.ok(summary.budgets.savedP75Ms <= 750, `save p75 ${summary.budgets.savedP75Ms}ms exceeded 750ms`);
assert.ok(summary.budgets.savedP95Ms <= 1_500, `save p95 ${summary.budgets.savedP95Ms}ms exceeded 1500ms`);
await (await import('node:fs/promises')).writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.budgets, null, 2));
