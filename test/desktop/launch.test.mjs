import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { _electron as electron } from '@playwright/test';

test('desktop shell opens the authenticated MDVE workbench', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'mdve-desktop-test-'));
  let app;
  try {
    app = await electron.launch({
      args: [`--user-data-dir=${join(dataRoot, 'electron')}`, resolve('.')],
      env: { ...process.env, MDVE_HOME: dataRoot, MDVE_DESKTOP_TEST: '1' },
    });
    const window = await app.firstWindow();
    await window.getByRole('region', { name: 'Diagram preview' }).waitFor({ state: 'visible' });
    await window.getByRole('region', { name: 'Diagram preview' }).click({ button: 'right', position: { x: 96, y: 96 } });
    const menu = window.getByRole('menu', { name: 'Preview context menu' });
    await menu.waitFor({ state: 'visible' });
    assert.equal(await menu.getByRole('menuitem', { name: 'Add node' }).isVisible(), true);
  } finally {
    await app?.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
