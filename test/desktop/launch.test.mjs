import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

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
        else reject(new Error('Could not allocate a desktop test port'));
      });
    });
  });
}

async function waitForCdp(port, child) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited before exposing CDP with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
      lastError = new Error(`CDP returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Electron did not expose CDP: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForPage(browser) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
    if (page) return page;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('Electron did not open its loopback workbench page');
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

function killDesktopProcesses(userDataDir) {
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

test('desktop shell opens the authenticated MDVE workbench', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'mdve-desktop-test-'));
  const electronDataRoot = join(dataRoot, 'electron');
  const cdpPort = await availablePort();
  const child = spawn(electronBinary, [
    '--no-sandbox',
    '--disable-gpu',
    '--ozone-platform=x11',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${electronDataRoot}`,
    resolve('.'),
  ], {
    env: { ...process.env, MDVE_HOME: dataRoot, MDVE_DESKTOP_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  let output = '';
  child.stdout.on('data', (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  });
  child.stderr.on('data', (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  });

  try {
    await waitForCdp(cdpPort, child);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const window = await waitForPage(browser);
    const preview = window.getByRole('region', { name: 'Diagram preview' });
    await preview.waitFor({ state: 'visible' });
    await preview.click({ button: 'right', position: { x: 96, y: 96 } });
    const menu = window.getByRole('menu', { name: 'Preview context menu' });
    await menu.waitFor({ state: 'visible' });
    assert.equal(await menu.getByRole('menuitem', { name: 'Add node' }).isVisible(), true);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}${output ? `\n${output}` : ''}`);
  } finally {
    await browser?.close().catch(() => undefined);
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      if (!(await waitForExit(child, 2_000))) child.kill('SIGKILL');
      await waitForExit(child, 2_000);
    }
    killDesktopProcesses(electronDataRoot);
    await rm(dataRoot, { recursive: true, force: true });
  }
});
