import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const appImage = process.argv[2] ? resolve(process.argv[2]) : null;
if (!appImage) throw new Error('Usage: node scripts/test-desktop-package.mjs <AppImage>');

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (port) resolvePort(port);
        else reject(new Error('Could not allocate a CDP port'));
      });
    });
  });
}

async function waitForCdp(port, child) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged MDVE exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
      lastError = new Error(`CDP returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Packaged MDVE did not expose CDP: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForPage(browser) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
    if (page) return page;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('Packaged MDVE did not open its loopback workbench page');
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

function killPackagedProcesses(userDataDir) {
  const processes = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(`--user-data-dir=${userDataDir}`));
  for (const line of processes) {
    const [pidText] = line.split(/\s+/, 1);
    const pid = Number(pidText);
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
  }
}

async function closeBrowser(browser) {
  if (!browser) return;
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise((resolveClose) => setTimeout(resolveClose, 1_000)),
  ]);
}

const dataRoot = await mkdtemp(join(tmpdir(), 'mdve-desktop-package-'));
const cdpPort = await availablePort();
const electronDataRoot = join(dataRoot, 'electron');
const child = spawn(appImage, [
  '--appimage-extract-and-run',
  '--no-sandbox',
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${electronDataRoot}`,
], {
  env: { ...process.env, MDVE_HOME: join(dataRoot, 'data') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForCdp(cdpPort, child);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await waitForPage(browser);
  const preview = page.getByRole('region', { name: 'Diagram preview' });
  await preview.waitFor({ state: 'visible' });
  await preview.click({ button: 'right', position: { x: 96, y: 96 } });
  const menu = page.getByRole('menu', { name: 'Preview context menu' });
  await menu.waitFor({ state: 'visible' });
  assert.equal(await menu.getByRole('menuitem', { name: 'Add node' }).isVisible(), true);
  console.log(JSON.stringify({ appImage, cdpPort, page: page.url() }, null, 2));
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ''}`);
} finally {
  await closeBrowser(browser);
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    if (!(await waitForExit(child, 2_000))) child.kill('SIGKILL');
    await waitForExit(child, 2_000);
  }
  killPackagedProcesses(electronDataRoot);
  await rm(dataRoot, { recursive: true, force: true });
}
