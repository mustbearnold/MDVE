import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

const root = process.cwd();
const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8'));
const tempRoot = await mkdtemp(join(tmpdir(), 'mdve-performance-'));
const prefix = join(tempRoot, 'prefix');
const dataRoot = join(tempRoot, 'data');
const outputPath = resolve(process.env.MDVE_PERFORMANCE_OUTPUT ?? join(root, 'test-results', 'performance.json'));
const sampleCount = Number(process.env.MDVE_PERFORMANCE_SAMPLES ?? 20);
if (!Number.isInteger(sampleCount) || sampleCount < 20) throw new Error('MDVE_PERFORMANCE_SAMPLES must be at least 20 for release evidence');
const warmPort = 4191;
const coldPortBase = 4200;
await mkdir(join(outputPath, '..'), { recursive: true });

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function statistics(values) {
  return {
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
  };
}

function vitalsInitScript() {
  return () => {
    const state = { lcp: null, cls: 0, tbt: 0 };
    window.__mdvePerformance = state;
    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
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
  };
}

async function measureEditToPreview(page) {
  await page.evaluate(() => {
    const measure = { start: performance.now(), end: null };
    window.__mdveEditPreview = measure;
    const observer = new MutationObserver(() => {
      const node = document.querySelector('g.node[aria-label="Node: Node 1"]');
      if (!node) return;
      const bounds = node.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        measure.end = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.waitForFunction(() => Number.isFinite(window.__mdveEditPreview?.end));
  return page.evaluate(() => window.__mdveEditPreview.end - window.__mdveEditPreview.start);
}

async function readVitals(page) {
  await page.waitForFunction(() => {
    const entry = performance.getEntriesByType('largest-contentful-paint').at(-1);
    if (entry) window.__mdvePerformance.lcp = entry.startTime;
    return Number.isFinite(window.__mdvePerformance?.lcp);
  }, { timeout: 5_000 });
  return page.evaluate(() => {
    const lcp = performance.getEntriesByType('largest-contentful-paint').at(-1);
    if (lcp) window.__mdvePerformance.lcp = lcp.startTime;
    return { ...window.__mdvePerformance };
  });
}

function flowchartFixture(index) {
  // This is the representative editing fixture: 100 nodes with a small
  // connected spine. Dense 200-node/300-edge opening remains a separate gate.
  const nodes = Array.from({ length: 100 }, (_, nodeIndex) => `  n${nodeIndex}[${nodeIndex === 0 ? `Sample ${index}` : `Node ${nodeIndex}`}]`);
  const edges = Array.from({ length: 2 }, (_, edgeIndex) => `  n${edgeIndex} --> n${edgeIndex + 1}`);
  return `flowchart LR\n${[...nodes, ...edges].join('\n')}\n`;
}

function denseFlowchartFixture(index) {
  // A 20x10 grid keeps the fixture genuinely dense (200 nodes/300 edges)
  // without turning the layout into a pathological 200-rank chain.
  const nodes = Array.from({ length: 200 }, (_, nodeIndex) => `  n${nodeIndex}[${nodeIndex === 0 ? `Dense sample ${index}` : `Node ${nodeIndex}`}]`);
  const horizontal = [];
  for (let row = 0; row < 20; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const from = row * 10 + column;
      horizontal.push(`  n${from} --> n${from + 1}`);
    }
  }
  const vertical = [];
  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      const from = row * 10 + column;
      vertical.push(`  n${from} --> n${from + 10}`);
    }
  }
  assert.equal(nodes.length, 200);
  assert.equal(horizontal.length + vertical.length, 300);
  return `flowchart TD\n${[...nodes, ...horizontal, ...vertical].join('\n')}\n`;
}

async function waitForDenseDiagram(page) {
  await page.waitForFunction(() => document.querySelectorAll('svg g.node').length >= 200);
}

let archive = process.env.MDVE_E2E_ARCHIVE;
if (!archive) {
  const releaseDir = join(tempRoot, 'release');
  await mkdir(releaseDir, { recursive: true });
  const output = execFileSync('npm', ['pack', '--pack-destination', releaseDir, '--json'], { cwd: root, encoding: 'utf8' });
  const jsonStart = output.indexOf('[\n  {');
  if (jsonStart === -1) throw new Error('npm pack did not return a JSON manifest');
  archive = join(releaseDir, JSON.parse(output.slice(jsonStart))[0].filename);
}

run(process.execPath, ['scripts/check-release-artifact.mjs', archive]);
run('npm', ['install', '--prefix', prefix, archive, '--omit=dev', '--ignore-scripts']);

const installedRoot = join(prefix, 'node_modules', packageJson.name);
const server = join(installedRoot, 'dist', 'server', 'index.js');
const launcher = join(installedRoot, 'bin', 'mdve.mjs');
const webDist = join(installedRoot, 'dist', 'web');
const fakeCodex = join(tempRoot, 'codex');
await writeFile(
  fakeCodex,
  `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 0.146.0'); process.exit(0); }
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { serverInfo: { version: '0.146.0' } } });
  if (message.method === 'account/read') send({ id: message.id, result: { account: { type: 'chatgpt' } } });
});
`, { encoding: 'utf8', mode: 0o755 });
await chmod(fakeCodex, 0o755);

const children = new Set();

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function waitForServer(port, output) {
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
  throw new Error(`performance server did not become ready: ${output()}`);
}

const warmChild = spawn(process.execPath, [server], {
  cwd: root,
  env: {
    ...process.env,
    MDVE_HOME: dataRoot,
    MDVE_HOST: '127.0.0.1',
    MDVE_PORT: String(warmPort),
    MDVE_AUTH_REQUIRED: '0',
    MDVE_VERSION: packageJson.version,
    MDVE_WEB_DIST: webDist,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.add(warmChild);
let warmOutput = '';
warmChild.stdout.on('data', (chunk) => { warmOutput += chunk.toString(); });
warmChild.stderr.on('data', (chunk) => { warmOutput += chunk.toString(); });

async function startColdLauncher(index) {
  const port = coldPortBase + index;
  const coldDataRoot = join(tempRoot, `cold-${index}`);
  const started = performance.now();
  const child = spawn(process.execPath, [launcher, '--no-open'], {
    cwd: root,
    env: {
      ...process.env,
      MDVE_CODEX_BIN: fakeCodex,
      MDVE_HOME: coldDataRoot,
      MDVE_HOST: '127.0.0.1',
      MDVE_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  let settled = false;
  const result = await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectReady(new Error(`cold launcher did not become ready: ${output}`));
      }
    }, 15_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/Open this URL to authenticate the local browser session:\n(https?:\/\/[^\n]+)/);
      if (!settled && match) {
        settled = true;
        clearTimeout(timer);
        resolveReady({ child, port, bootstrapUrl: match[1], cliToReadyMs: performance.now() - started });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectReady(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectReady(new Error(`cold launcher exited before ready (${code ?? signal ?? 'unknown'}): ${output}`));
    });
  });
  return result;
}

const coldLaunches = [];
const denseColdOpenings = [];
const warmNavigations = [];
const denseWarmOpenings = [];
const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
try {
  await waitForServer(warmPort, () => warmOutput);

  for (let index = 0; index < sampleCount; index += 1) {
    console.log(`[performance] cold sample ${index + 1}/${sampleCount} starting`);
    const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(15_000);
    await page.addInitScript(vitalsInitScript());
    const cold = await startColdLauncher(index);
    try {
      const navigationStarted = performance.now();
      await page.goto(cold.bootstrapUrl);
      await page.getByRole('heading', { name: 'Preview' }).waitFor();
      await page.getByText('Saved · revision 1').waitFor();
      const metrics = await readVitals(page);
      coldLaunches.push({
        index,
        cliToReadyMs: cold.cliToReadyMs,
        navigationToUsableMs: performance.now() - navigationStarted,
        lcpMs: metrics.lcp,
        cls: metrics.cls,
        tbtMs: metrics.tbt,
      });

      const denseResponse = await page.request.post(`http://127.0.0.1:${cold.port}/api/sessions`, {
        data: { title: `Dense cold ${index}`, source: denseFlowchartFixture(index) },
      });
      assert.equal(denseResponse.ok(), true);
      const denseSession = (await denseResponse.json()).session;
      await page.evaluate((id) => localStorage.setItem('mdve.session', id), denseSession.id);
      const denseStarted = performance.now();
      await page.reload();
      await page.getByRole('heading', { name: 'Preview' }).waitFor();
      await page.getByText('Saved · revision 1').waitFor();
      await waitForDenseDiagram(page);
      const denseMetrics = await readVitals(page);
      denseColdOpenings.push({
        index,
        openMs: performance.now() - denseStarted,
        lcpMs: denseMetrics.lcp,
        cls: denseMetrics.cls,
        tbtMs: denseMetrics.tbt,
      });
      console.log(`[performance] cold sample ${index + 1}/${sampleCount} complete cli=${cold.cliToReadyMs.toFixed(1)}ms`);
    } finally {
      await stopChild(cold.child);
      children.delete(cold.child);
      await context.close();
    }
  }

  for (let index = 0; index < sampleCount; index += 1) {
    console.log(`[performance] warm sample ${index + 1}/${sampleCount} starting`);
    const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(15_000);
    await page.addInitScript(vitalsInitScript());

    let navigationStarted;
    const response = await page.request.post(`http://127.0.0.1:${warmPort}/api/sessions`, {
      data: { title: `Performance ${index}` },
    });
    assert.equal(response.ok(), true);
    const session = (await response.json()).session;
    const secondResponse = await page.request.post(`http://127.0.0.1:${warmPort}/api/sessions`, {
      data: { title: `Performance switch ${index}` },
    });
    assert.equal(secondResponse.ok(), true);
    const second = (await secondResponse.json()).session;
    const denseResponse = await page.request.post(`http://127.0.0.1:${warmPort}/api/sessions`, {
      data: { title: `Dense warm ${index}`, source: denseFlowchartFixture(index) },
    });
    assert.equal(denseResponse.ok(), true);
    const denseSession = (await denseResponse.json()).session;
    await page.goto(`http://127.0.0.1:${warmPort}/`);
    await page.evaluate((id) => localStorage.setItem('mdve.session', id), denseSession.id);
    const denseStarted = performance.now();
    await page.reload();
    await page.getByRole('heading', { name: 'Preview' }).waitFor();
    await page.getByText('Saved · revision 1').waitFor();
    await waitForDenseDiagram(page);
    const denseMetrics = await readVitals(page);
    denseWarmOpenings.push({
      index,
      openMs: performance.now() - denseStarted,
      lcpMs: denseMetrics.lcp,
      cls: denseMetrics.cls,
      tbtMs: denseMetrics.tbt,
    });

    navigationStarted = performance.now();
    await page.goto(`http://127.0.0.1:${warmPort}/`);
    await page.evaluate((id) => localStorage.setItem('mdve.session', id), session.id);
    await page.reload();
    await page.getByRole('heading', { name: 'Preview' }).waitFor();
    await page.getByText('Saved · revision 1').waitFor();
    const usableMs = performance.now() - navigationStarted;

    await page.getByRole('button', { name: 'Source' }).click();
    await page.getByRole('textbox', { name: 'Mermaid source' }).fill(flowchartFixture(index));
    // The release budget starts at the completed final editor input event,
    // rather than charging the user for switching into the Source tab or for
    // Playwright's cross-process measurement round trips.
    const editStarted = performance.now();
    const editToPreviewMs = await measureEditToPreview(page);
    await page.getByText('Saved · revision 2').waitFor();
    const editToSavedMs = performance.now() - editStarted;

    const switchStarted = performance.now();
    await page.getByLabel('Diagram', { exact: true }).selectOption(second.id);
    await page.getByText('Saved · revision 1').waitFor();
    const switchMs = performance.now() - switchStarted;

    const metrics = await readVitals(page);
    warmNavigations.push({ index, usableMs, editToPreviewMs, editToSavedMs, switchMs, lcpMs: metrics.lcp, cls: metrics.cls, tbtMs: metrics.tbt });
    console.log(`[performance] warm sample ${index + 1}/${sampleCount} complete usable=${usableMs.toFixed(1)}ms saved=${editToSavedMs.toFixed(1)}ms`);
    await context.close();
  }
} finally {
  await browser.close();
  for (const child of children) {
    await stopChild(child);
  }
}

const coldCli = coldLaunches.map((sample) => sample.cliToReadyMs);
const coldNavigation = coldLaunches.map((sample) => sample.navigationToUsableMs);
const coldLcp = coldLaunches.map((sample) => sample.lcpMs).filter((value) => typeof value === 'number');
const coldCls = coldLaunches.map((sample) => sample.cls);
const coldTbt = coldLaunches.map((sample) => sample.tbtMs);
const denseColdOpen = denseColdOpenings.map((sample) => sample.openMs);
const denseColdLcp = denseColdOpenings.map((sample) => sample.lcpMs).filter((value) => typeof value === 'number');
const denseColdCls = denseColdOpenings.map((sample) => sample.cls);
const denseColdTbt = denseColdOpenings.map((sample) => sample.tbtMs);
const usable = warmNavigations.map((sample) => sample.usableMs);
const saved = warmNavigations.map((sample) => sample.editToSavedMs);
const editToPreview = warmNavigations.map((sample) => sample.editToPreviewMs);
const switchTimes = warmNavigations.map((sample) => sample.switchMs);
const denseWarmOpen = denseWarmOpenings.map((sample) => sample.openMs);
const denseWarmLcp = denseWarmOpenings.map((sample) => sample.lcpMs).filter((value) => typeof value === 'number');
const denseWarmCls = denseWarmOpenings.map((sample) => sample.cls);
const denseWarmTbt = denseWarmOpenings.map((sample) => sample.tbtMs);

const summary = {
  schemaVersion: 3,
  archive,
  version: packageJson.version,
  protocol: {
    coldLaunches: sampleCount,
    warmNavigations: sampleCount,
    denseColdOpenings: sampleCount,
    denseWarmOpenings: sampleCount,
    browser: 'Chromium',
    viewport: { width: 800, height: 900 },
  },
  environment: {
    node: process.versions.node,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    platform: platform(),
    osRelease: release(),
    arch: process.arch,
    cpuCount: cpus().length,
    memoryBytes: totalmem(),
    browser: browserVersion,
    fixture: '100-node/2-edge flowchart edit plus a 200-node/300-edge dense flowchart opening',
  },
  samples: { coldLaunches, denseColdOpenings, warmNavigations, denseWarmOpenings },
  statistics: {
    coldCliToReadyMs: statistics(coldCli),
    coldNavigationToUsableMs: statistics(coldNavigation),
    lcpMs: statistics(coldLcp),
    cls: statistics(coldCls),
    tbtMs: statistics(coldTbt),
    denseColdOpenMs: statistics(denseColdOpen),
    denseColdLcpMs: statistics(denseColdLcp),
    denseColdCls: statistics(denseColdCls),
    denseColdTbtMs: statistics(denseColdTbt),
    warmUsableMs: statistics(usable),
    editToPreviewMs: statistics(editToPreview),
    editToSavedMs: statistics(saved),
    switchMs: statistics(switchTimes),
    denseWarmOpenMs: statistics(denseWarmOpen),
    denseWarmLcpMs: statistics(denseWarmLcp),
    denseWarmCls: statistics(denseWarmCls),
    denseWarmTbtMs: statistics(denseWarmTbt),
  },
  budgets: {
    coldCliToReadyP75Ms: percentile(coldCli, 0.75),
    coldCliToReadyP95Ms: percentile(coldCli, 0.95),
    coldNavigationToUsableP75Ms: percentile(coldNavigation, 0.75),
    coldNavigationToUsableP95Ms: percentile(coldNavigation, 0.95),
    lcpP75Ms: coldLcp.length === coldLaunches.length ? percentile(coldLcp, 0.75) : null,
    clsP75: percentile(coldCls, 0.75),
    tbtP75Ms: percentile(coldTbt, 0.75),
    denseColdOpenP75Ms: percentile(denseColdOpen, 0.75),
    denseColdOpenP95Ms: percentile(denseColdOpen, 0.95),
    denseColdLcpP75Ms: denseColdLcp.length === denseColdOpenings.length ? percentile(denseColdLcp, 0.75) : null,
    denseColdClsP75: percentile(denseColdCls, 0.75),
    denseColdTbtP75Ms: percentile(denseColdTbt, 0.75),
    warmUsableP75Ms: percentile(usable, 0.75),
    warmUsableP95Ms: percentile(usable, 0.95),
    editToPreviewP75Ms: percentile(editToPreview, 0.75),
    editToPreviewP95Ms: percentile(editToPreview, 0.95),
    savedP75Ms: percentile(saved, 0.75),
    savedP95Ms: percentile(saved, 0.95),
    switchP75Ms: percentile(switchTimes, 0.75),
    switchP95Ms: percentile(switchTimes, 0.95),
    denseWarmOpenP75Ms: percentile(denseWarmOpen, 0.75),
    denseWarmOpenP95Ms: percentile(denseWarmOpen, 0.95),
    denseWarmLcpP75Ms: denseWarmLcp.length === denseWarmOpenings.length ? percentile(denseWarmLcp, 0.75) : null,
    denseWarmClsP75: percentile(denseWarmCls, 0.75),
    denseWarmTbtP75Ms: percentile(denseWarmTbt, 0.75),
  },
};

assert.equal(coldLaunches.length, sampleCount);
assert.equal(denseColdOpenings.length, sampleCount);
assert.equal(warmNavigations.length, sampleCount);
assert.equal(denseWarmOpenings.length, sampleCount);
assert.equal(coldLcp.length, sampleCount, 'LCP was not measured for every cold navigation');
assert.equal(denseColdLcp.length, sampleCount, 'dense cold LCP was not measured for every opening');
assert.equal(denseWarmLcp.length, sampleCount, 'dense warm LCP was not measured for every opening');
assert.ok(summary.budgets.coldCliToReadyP75Ms <= 2_000, `cold CLI p75 ${summary.budgets.coldCliToReadyP75Ms}ms exceeded 2000ms`);
assert.ok(summary.budgets.coldCliToReadyP95Ms <= 3_000, `cold CLI p95 ${summary.budgets.coldCliToReadyP95Ms}ms exceeded 3000ms`);
assert.ok(summary.budgets.lcpP75Ms <= 2_500, `LCP p75 ${summary.budgets.lcpP75Ms}ms exceeded 2500ms`);
assert.ok(summary.budgets.clsP75 <= 0.1, `CLS p75 ${summary.budgets.clsP75} exceeded 0.1`);
assert.ok(summary.budgets.tbtP75Ms <= 200, `TBT p75 ${summary.budgets.tbtP75Ms}ms exceeded 200ms`);
assert.ok(summary.budgets.denseColdOpenP95Ms <= 1_000, `dense cold open p95 ${summary.budgets.denseColdOpenP95Ms}ms exceeded 1000ms`);
assert.ok(summary.budgets.denseColdLcpP75Ms <= 2_500, `dense cold LCP p75 ${summary.budgets.denseColdLcpP75Ms}ms exceeded 2500ms`);
assert.ok(summary.budgets.denseColdClsP75 <= 0.1, `dense cold CLS p75 ${summary.budgets.denseColdClsP75} exceeded 0.1`);
assert.ok(summary.budgets.warmUsableP75Ms <= 2_000, `warm usable p75 ${summary.budgets.warmUsableP75Ms}ms exceeded 2000ms`);
assert.ok(summary.budgets.warmUsableP95Ms <= 3_000, `warm usable p95 ${summary.budgets.warmUsableP95Ms}ms exceeded 3000ms`);
assert.ok(summary.budgets.editToPreviewP75Ms <= 200, `edit-to-preview p75 ${summary.budgets.editToPreviewP75Ms}ms exceeded 200ms`);
assert.ok(summary.budgets.editToPreviewP95Ms <= 500, `edit-to-preview p95 ${summary.budgets.editToPreviewP95Ms}ms exceeded 500ms`);
assert.ok(summary.budgets.savedP75Ms <= 750, `save p75 ${summary.budgets.savedP75Ms}ms exceeded 750ms`);
assert.ok(summary.budgets.savedP95Ms <= 1_500, `save p95 ${summary.budgets.savedP95Ms}ms exceeded 1500ms`);
assert.ok(summary.budgets.switchP75Ms <= 500, `switch p75 ${summary.budgets.switchP75Ms}ms exceeded 500ms`);
assert.ok(summary.budgets.switchP95Ms <= 1_000, `switch p95 ${summary.budgets.switchP95Ms}ms exceeded 1000ms`);
assert.ok(summary.budgets.denseWarmOpenP95Ms <= 1_000, `dense warm open p95 ${summary.budgets.denseWarmOpenP95Ms}ms exceeded 1000ms`);
assert.ok(summary.budgets.denseWarmLcpP75Ms <= 2_500, `dense warm LCP p75 ${summary.budgets.denseWarmLcpP75Ms}ms exceeded 2500ms`);
assert.ok(summary.budgets.denseWarmClsP75 <= 0.1, `dense warm CLS p75 ${summary.budgets.denseWarmClsP75} exceeded 0.1`);

await (await import('node:fs/promises')).writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.budgets, null, 2));
