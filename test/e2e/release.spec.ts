import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const browserErrors = new WeakMap<Page, string[]>();

async function waitForSaved(page: Page, revision: number): Promise<void> {
  await expect(page.getByText(`Saved · revision ${revision}`)).toBeVisible({ timeout: 10_000 });
}

async function seedRecoveryDraft(page: Page, draft: { sessionId: string; source: string; baseRevision: number }): Promise<void> {
  await page.evaluate((value) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mdve-recovery', 1);
    request.onerror = () => reject(request.error ?? new Error('Could not open recovery database'));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts', { keyPath: 'sessionId' });
    };
    request.onsuccess = () => {
      try {
        const transaction = request.result.transaction('drafts', 'readwrite');
        transaction.oncomplete = () => {
          request.result.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('Could not seed recovery draft'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Could not seed recovery draft'));
        transaction.objectStore('drafts').put({ ...value, updatedAt: Date.now() });
      } catch (error) {
        request.result.close();
        reject(error);
      }
    };
  }), draft);
}

async function waitForLibraryScope(page: Page, scope: string, sessionId: string): Promise<void> {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions?scope=${scope}`);
    const body = (await response.json()) as { sessions: Array<{ id: string }> };
    return body.sessions.some((session) => session.id === sessionId);
  }, { timeout: 10_000 }).toBe(true);
}

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.setViewportSize({ width: 800, height: 900 });
  const response = await page.request.post('/api/sessions', {
    data: { title: `Browser ${testInfo.project.name} ${testInfo.testId}` },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { session: { id: string } };

  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('mdve.session', id), body.session.id);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await waitForSaved(page, 1);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? [], 'browser console/page errors').toEqual([]);
});

test('the packaged browser workflow edits, saves, previews, exports, and restores history', async ({ page }) => {
  await page.getByRole('button', { name: 'Source' }).click();
  const source = page.getByRole('textbox', { name: 'Mermaid source' });
  await source.fill('flowchart TD\n  start[Start] --> done[Done]\n');
  await waitForSaved(page, 2);

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('button', { name: 'Node: Start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Node: Done' })).toBeVisible();

  await page.locator('summary').filter({ hasText: 'File' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Mermaid source' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mmd$/);

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Revision 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare revision 1' }).click();
  const comparison = page.getByRole('region', { name: 'Revision 1 compared with current' });
  await expect(comparison).toBeVisible();
  await expect(comparison).toContainText('Current revision 2');
  await expect(comparison.locator('.history-diff-added')).toHaveCount(1);
  const restoreButtons = page.getByRole('button', { name: 'Restore as new revision' });
  expect(await restoreButtons.count()).toBe(2);
  await restoreButtons.nth(1).click();
  await waitForSaved(page, 3);
});

test('the diagram library exposes Recent, Archived, and recoverable Trash scopes', async ({ page }) => {
  const originalId = await page.locator('#diagram-select').inputValue();
  const menu = page.locator('summary').filter({ hasText: 'Diagram' });
  await menu.click();
  await page.getByRole('button', { name: 'New diagram' }).click();
  await expect.poll(() => page.locator('#diagram-select').inputValue()).not.toBe(originalId);
  const newId = await page.locator('#diagram-select').inputValue();

  await menu.click();
  await page.getByRole('button', { name: 'Archive diagram' }).click();
  await waitForLibraryScope(page, 'archived', newId);

  await page.getByLabel('Diagram library').selectOption('archived');
  await expect(page.locator(`#diagram-select option[value="${newId}"]`)).toHaveCount(1);
  await page.locator('#diagram-select').selectOption(newId);
  await menu.click();
  await expect(page.getByRole('button', { name: 'Restore diagram' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore diagram' }).click();
  await waitForLibraryScope(page, 'recent', newId);

  await menu.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move diagram to Trash' }).click();
  await waitForLibraryScope(page, 'trash', newId);
  await page.getByLabel('Diagram library').selectOption('trash');
  await expect(page.locator(`#diagram-select option[value="${newId}"]`)).toHaveCount(1);
  await page.locator('#diagram-select').selectOption(newId);
  await menu.click();
  await expect(page.getByRole('button', { name: 'Delete diagram permanently' })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
});

test('the diagram library can duplicate a source-backed diagram', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart LR\n  start[Start] --> finish[Finish]\n');
  await waitForSaved(page, 2);

  const originalId = await page.locator('#diagram-select').inputValue();
  const menu = page.locator('summary').filter({ hasText: 'Diagram' });
  await menu.click();
  await page.getByRole('button', { name: 'Duplicate diagram' }).click();

  await expect.poll(() => page.locator('#diagram-select').inputValue()).not.toBe(originalId);
  await expect(page.locator('#diagram-select option:checked')).toHaveText(/Copy of/);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Node: Start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Node: Finish' })).toBeVisible();
});

test('durable conversations and every workbench state have accessible names', async ({ page }) => {
  for (const view of ['Preview', 'Source', 'Inspector', 'Agent', 'History']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations, `${view} accessibility violations`).toEqual([]);
  }

  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  const conversationSelect = page.getByLabel('Conversation', { exact: true });
  await expect(conversationSelect).toHaveValue(/.+/);
  await expect(conversationSelect.locator('option:checked')).toHaveText(/New conversation · ready/);
  await expect(page.getByText(/ready · Diagram revision 1/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByLabel('Conversation', { exact: true }).locator('option:checked')).toHaveText(/New conversation · ready/);

  await page.getByRole('button', { name: 'Archive conversation' }).click();
  await expect(page.getByRole('button', { name: 'Restore conversation' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore conversation' }).click();
  await expect(page.getByRole('button', { name: 'Archive conversation' })).toBeVisible();
});

test('compact layout keeps the critical edit and recovery path operable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Source' }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  compact[Compact] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Revision 2', { exact: true })).toBeVisible();

  for (const view of ['Preview', 'Source', 'Inspector', 'Agent', 'History']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations, `${view} compact accessibility violations`).toEqual([]);
  }
});

test('intermediate desktop toolbar reflows before controls collide', async ({ page }) => {
  await page.setViewportSize({ width: 1160, height: 800 });
  const geometry = await page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar');
    const context = document.querySelector('.toolbar-context');
    const status = document.querySelector('.save-status');
    const nodeButton = [...document.querySelectorAll('.toolbar button')].find((button) => button.textContent?.includes('Node'));
    if (!toolbar || !context || !status || !nodeButton) throw new Error('Toolbar geometry is incomplete');
    const statusRect = status.getBoundingClientRect();
    const nodeRect = nodeButton.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      contextOverflow: context.scrollWidth - context.clientWidth,
      toolbarHeight: toolbar.getBoundingClientRect().height,
      statusBottom: statusRect.bottom,
      nodeTop: nodeRect.top,
    };
  });

  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.contextOverflow).toBeLessThanOrEqual(1);
  expect(geometry.toolbarHeight).toBeGreaterThan(59);
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.nodeTop + 1);
});

test('desktop context dock keeps one focused context visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const geometry = await page.evaluate(() => {
    const inspector = document.querySelector('.side-inspector')?.getBoundingClientRect();
    const agent = document.querySelector('.side-agent')?.getBoundingClientRect();
    const chatLog = document.querySelector('.chat-log');
    if (!inspector || !agent || !chatLog) throw new Error('Desktop side-panel geometry is incomplete');
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      inspectorHeight: inspector.height,
      agentHeight: agent.height,
      chatLogHeight: chatLog.getBoundingClientRect().height,
      chatLogScrollHeight: chatLog.scrollHeight,
      settingsOpen: document.querySelector('.chat-settings')?.hasAttribute('open'),
      examplesOpen: document.querySelector('.chat-examples')?.hasAttribute('open'),
    };
  });

  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.inspectorHeight).toBeGreaterThan(400);
  expect(geometry.agentHeight).toBe(0);

  await page.locator('.activity-rail').getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator('.side-agent').boundingBox())?.height ?? 0).toBeGreaterThan(400);
  const agentGeometry = await page.evaluate(() => {
    const inspector = document.querySelector('.side-inspector')?.getBoundingClientRect();
    const agent = document.querySelector('.side-agent')?.getBoundingClientRect();
    const chatLog = document.querySelector('.chat-log');
    if (!inspector || !agent || !chatLog) throw new Error('Focused desktop side-panel geometry is incomplete');
    return {
      inspectorHeight: inspector.height,
      agentHeight: agent.height,
      chatLogHeight: chatLog.getBoundingClientRect().height,
      chatLogScrollHeight: chatLog.scrollHeight,
      settingsOpen: document.querySelector('.chat-settings')?.hasAttribute('open'),
      examplesOpen: document.querySelector('.chat-examples')?.hasAttribute('open'),
    };
  });

  expect(agentGeometry.inspectorHeight).toBe(0);
  expect(agentGeometry.agentHeight).toBeGreaterThan(agentGeometry.inspectorHeight);
  expect(agentGeometry.chatLogHeight).toBeGreaterThan(100);
  expect(agentGeometry.chatLogScrollHeight).toBeLessThanOrEqual(agentGeometry.chatLogHeight + 1);
  expect(agentGeometry.settingsOpen).toBe(false);
  expect(agentGeometry.examplesOpen).toBe(false);

  await page.locator('.chat-settings summary').click();
  await expect(page.getByLabel('Provider')).toBeVisible();
  await page.locator('.chat-settings summary').click();
  await expect(page.getByLabel('Provider')).toBeHidden();
});

test('v2 canvas shell exposes activity navigation, command palette, and agent tray', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Workbench activity' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask MDVE to change this diagram' })).toBeVisible();

  await page.getByRole('button', { name: 'Open command palette' }).click();
  const palette = page.getByRole('dialog', { name: 'What do you want to do?' });
  await expect(palette).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search commands' })).toBeFocused();
  const paletteAccessibility = await new AxeBuilder({ page }).analyze();
  expect(paletteAccessibility.violations, 'command palette accessibility violations').toEqual([]);
  await palette.getByRole('button', { name: 'Open agent' }).click();
  await expect(palette).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Change request', exact: true })).toBeVisible();

  const quickChange = page.getByRole('textbox', { name: 'Quick change request' });
  await quickChange.fill('Add a retry path after validation');
  await page.getByRole('button', { name: 'Open Agent with change request' }).click();
  await expect(page.getByRole('textbox', { name: 'Change request', exact: true })).toHaveValue('Add a retry path after validation');

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill(
    'flowchart TD\n  start[Start] --> decide{Decide}\n  decide -->|yes| done[Done]\n',
  );
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.locator('.activity-rail').getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outline', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select node Decide (decide)' })).toBeVisible();
  const outlineAccessibility = await new AxeBuilder({ page }).analyze();
  expect(outlineAccessibility.violations, 'outline accessibility violations').toEqual([]);
  await page.getByRole('button', { name: 'Select node Decide (decide)' }).click();
  await expect(page.locator('.outline-item-active')).toContainText('Decide');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.locator('#workbench-inspector').getByRole('heading', { name: 'Node', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill('focus canvas');
  await page.getByRole('button', { name: 'Focus canvas' }).click();
  await expect(page.locator('.app')).toHaveClass(/focus-mode/);
  await expect(page.getByRole('navigation', { name: 'Workbench activity' })).toBeHidden();
  await expect(page.locator('#workbench-source')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveClass(/focus-mode/);
  await expect(page.getByRole('navigation', { name: 'Workbench activity' })).toBeVisible();

  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill('history');
  await expect(page.getByRole('button', { name: 'Open history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open source' })).toBeHidden();
  await page.getByRole('button', { name: 'Open history' }).click();
  await expect(page.locator('#workbench-history').getByRole('heading', { name: 'History', exact: true })).toBeVisible();

  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('v3 command center runs durable diagram edits', async ({ page }) => {
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  start[Start]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'What do you want to do?' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('add node');
  await palette.getByRole('button', { name: 'Add node' }).click();

  await waitForSaved(page, 3);
  await expect(page.getByRole('button', { name: 'Node: New node' })).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('New node');
  }).toBe(true);
});

test('the free plan exposes Pro presentation and local BYOK without hiding the core editor', async ({ page }) => {
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep your diagrams moving' })).toBeVisible();
  await expect(page.getByText('The complete local Mermaid workbench stays free.')).toBeVisible();
  await page.getByRole('button', { name: 'Close licensing dialog' }).click();

  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.locator('.chat-settings summary').click();
  await page.getByLabel('Provider', { exact: true }).selectOption('openai-compatible');
  await page.getByRole('button', { name: 'Configure BYOK' }).click();
  await expect(page.getByRole('heading', { name: 'Use your own AI key' })).toBeVisible();
  await page.locator('#byok-base-url').fill('http://127.0.0.1:11434/v1');
  await page.locator('#byok-model').fill('local-model');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await page.request.delete('/api/providers/openai-compatible/config');
});

test('large text, forced colors, and reduced motion preserve the critical workflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  zoom[Large text] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Node: Large text' })).toBeVisible();
});

test('400% zoom and text spacing keep toolbar controls usable', async ({ page }) => {
  // A 1280 CSS-pixel desktop viewport at 400% browser zoom has a 320 CSS-pixel
  // layout viewport. Add the WCAG text-spacing override on top of that narrow
  // layout so the assertion covers both reflow and expanded glyph spacing.
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.style.letterSpacing = '0.12em';
    document.documentElement.style.wordSpacing = '0.16em';
    document.documentElement.style.lineHeight = '1.5';
  });

  const metrics = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll('.toolbar button, .toolbar select, .toolbar input, .toolbar summary')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? '',
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
        };
      });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      controls,
      overflow: controls.filter((control) => control.left < -1 || control.right > window.innerWidth + 1),
      undersized: controls.filter((control) => control.width < 24 || control.height < 24),
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.overflow).toEqual([]);
  expect(metrics.undersized).toEqual([]);

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  reflow[Reflow] --> done[Done]\n');
  await waitForSaved(page, 2);
});

test('keyboard-only editing, preview, and recovery remain operable', async ({ page }) => {
  const sourceTab = page.getByRole('button', { name: 'Source', exact: true });
  await sourceTab.focus();
  await page.keyboard.press('Enter');

  const source = page.getByRole('textbox', { name: 'Mermaid source' });
  await source.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('flowchart TD\n  keyboard[Keyboard] --> done[Done]\n');
  await waitForSaved(page, 2);

  const previewTab = page.getByRole('button', { name: 'Preview', exact: true });
  await previewTab.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Node: Keyboard' })).toBeVisible();

  const historyTab = page.getByRole('button', { name: 'History', exact: true });
  await historyTab.focus();
  await page.keyboard.press('Enter');
  const restoreButtons = page.getByRole('button', { name: 'Restore as new revision' });
  await restoreButtons.nth(1).focus();
  await page.keyboard.press('Enter');
  await waitForSaved(page, 3);
});

test('preview supports pointer dragging and direct node label editing', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Mermaid source' });
  await source.fill('flowchart TD\n  start[Start] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const node = page.getByRole('button', { name: 'Node: Start' });
  await expect(node).toBeVisible();
  const stage = page.locator('.preview-stage');
  const beforeTransform = await stage.getAttribute('style');
  const nodeBoxBeforeDrag = await node.boundingBox();
  expect(nodeBoxBeforeDrag).toBeTruthy();
  await page.mouse.move(nodeBoxBeforeDrag!.x + nodeBoxBeforeDrag!.width / 2, nodeBoxBeforeDrag!.y + nodeBoxBeforeDrag!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBoxBeforeDrag!.x + nodeBoxBeforeDrag!.width / 2 + 72, nodeBoxBeforeDrag!.y + nodeBoxBeforeDrag!.height / 2 + 28, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => stage.getAttribute('style')).toBe(beforeTransform);
  const nodeBoxAfterDrag = await node.boundingBox();
  expect(nodeBoxAfterDrag).toBeTruthy();
  expect(nodeBoxAfterDrag!.x - nodeBoxBeforeDrag!.x).toBeGreaterThan(50);
  expect(nodeBoxAfterDrag!.y - nodeBoxBeforeDrag!.y).toBeGreaterThan(10);

  await page.waitForTimeout(120);
  await expect(page.getByRole('textbox', { name: 'Edit node label' })).toBeHidden();
  const editBox = await node.boundingBox();
  expect(editBox).toBeTruthy();
  await page.mouse.click(editBox!.x + editBox!.width / 2, editBox!.y + editBox!.height / 2);
  const editor = page.getByRole('textbox', { name: 'Edit node label' });
  await expect(editor).toBeVisible();
  await editor.fill('Begin');
  await editor.press('Enter');
  await expect.poll(async () => {
    const text = await page.locator('.save-status').textContent();
    const match = /revision (\d+)/.exec(text ?? '');
    return match ? Number(match[1]) : 0;
  }).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('button', { name: 'Node: Begin' })).toBeVisible();
});

test('preview keeps edge-label dragging separate from canvas panning', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill(
    'flowchart TD\n  start[Start] --> decide{Decide}\n  decide -->|yes| build[Build]\n  decide -->|no| wait[Wait]\n',
  );
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const yesLabel = page.locator('g.edgeLabel').filter({ hasText: 'yes' });
  await expect(yesLabel).toHaveCount(1);
  await expect(yesLabel).toBeVisible();
  const stage = page.locator('.preview-stage');
  const beforeTransform = await stage.getAttribute('style');
  const labelBoxBeforeDrag = await yesLabel.boundingBox();
  expect(labelBoxBeforeDrag).toBeTruthy();
  await page.mouse.move(labelBoxBeforeDrag!.x + labelBoxBeforeDrag!.width / 2, labelBoxBeforeDrag!.y + labelBoxBeforeDrag!.height / 2);
  await page.mouse.down();
  await page.mouse.move(labelBoxBeforeDrag!.x + labelBoxBeforeDrag!.width / 2 + 56, labelBoxBeforeDrag!.y + labelBoxBeforeDrag!.height / 2 + 22, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => stage.getAttribute('style')).toBe(beforeTransform);
  const labelBoxAfterDrag = await yesLabel.boundingBox();
  expect(labelBoxAfterDrag).toBeTruthy();
  expect(labelBoxAfterDrag!.x - labelBoxBeforeDrag!.x).toBeGreaterThan(40);
  expect(labelBoxAfterDrag!.y - labelBoxBeforeDrag!.y).toBeGreaterThan(10);
});

test('preview edge-label moves are durable and resettable', async ({ page }) => {
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill(
    'flowchart TD\n  start[Start] --> decide{Decide}\n  decide -->|yes| build[Build]\n  decide -->|no| wait[Wait]\n',
  );
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const yesLabel = page.locator('g.edgeLabel').filter({ hasText: 'yes' });
  const before = await yesLabel.boundingBox();
  expect(before).toBeTruthy();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 64, before!.y + before!.height / 2 + 24, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('%% mdve:edge-label-position');
  }).toBe(true);
  const after = await yesLabel.boundingBox();
  expect(after).toBeTruthy();
  expect(after!.x - before!.x).toBeGreaterThan(44);
  expect(after!.y - before!.y).toBeGreaterThan(12);

  await page.reload();
  const afterReload = await page.locator('g.edgeLabel').filter({ hasText: 'yes' }).boundingBox();
  expect(afterReload).toBeTruthy();
  expect(afterReload!.x - before!.x).toBeGreaterThan(44);
  expect(afterReload!.y - before!.y).toBeGreaterThan(12);

  await page.getByRole('button', { name: 'Reset saved node positions' }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('mdve:edge-label-position');
  }).toBe(false);
  await expect(page.getByRole('button', { name: 'Reset saved node positions' })).toBeDisabled();
});

test('preview context menu can add a node', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  start[Start] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const canvas = page.getByRole('region', { name: 'Diagram preview' });
  await canvas.click({ button: 'right', position: { x: 96, y: 96 } });
  const menu = page.getByRole('menu', { name: 'Preview context menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Add node' })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations, 'preview context menu accessibility violations').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await canvas.click({ button: 'right', position: { x: 96, y: 96 } });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Add node' }).click();

  await waitForSaved(page, 3);
  await expect(page.getByRole('button', { name: 'Node: New node' })).toBeVisible();
  await expect(menu).toBeHidden();
});

test('preview node moves are durable and resettable', async ({ page }) => {
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  start[Start] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const node = page.getByRole('button', { name: 'Node: Start' });
  const before = await node.boundingBox();
  expect(before).toBeTruthy();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 84, before!.y + before!.height / 2 + 32, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await page.request.get(`/api/sessions/${sessionId}`)).status()).toBe(200);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('%% mdve:position start');
  }).toBe(true);

  const after = await node.boundingBox();
  expect(after).toBeTruthy();
  expect(after!.x - before!.x).toBeGreaterThan(60);
  expect(after!.y - before!.y).toBeGreaterThan(20);
  const movedSource = await page.request.get(`/api/sessions/${sessionId}`);
  expect((await movedSource.json()).source).toContain('%% mdve:position start');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Node: Start' })).toBeVisible();
  const afterReload = await page.getByRole('button', { name: 'Node: Start' }).boundingBox();
  expect(afterReload).toBeTruthy();
  expect(afterReload!.x - before!.x).toBeGreaterThan(60);
  expect(afterReload!.y - before!.y).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Reset saved node positions' }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('%% mdve:position');
  }).toBe(false);
  await expect(page.getByRole('button', { name: 'Reset saved node positions' })).toBeDisabled();
});

test('v3 preview editing has a keyboard nudge path', async ({ page }) => {
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  start[Start] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const node = page.getByRole('button', { name: 'Node: Start' });
  await node.focus();
  await expect(node).toBeFocused();
  const stageBefore = await page.locator('.preview-stage').getAttribute('style');
  await page.keyboard.press('Shift+ArrowRight');

  await waitForSaved(page, 3);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('%% mdve:position start');
  }).toBe(true);
  await expect(page.locator('.preview-stage')).toHaveAttribute('style', stageBefore ?? '');
});

test('v3 canvas selection groups nodes and commits one layout transaction', async ({ page }) => {
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill(
    'flowchart TD\n  alpha[Alpha]\n  beta[Beta]\n  gamma[Gamma]\n',
  );
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await page.getByRole('button', { name: 'Node: Alpha' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Node: Beta' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Selection', exact: true })).toBeVisible();
  await expect(page.getByText('2 nodes selected · Shift-click to add or remove nodes.')).toBeVisible();

  await page.getByRole('button', { name: 'Align vertical' }).click();
  await waitForSaved(page, 3);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('%% mdve:position alpha') && body.source.includes('%% mdve:position beta');
  }).toBe(true);

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const alpha = page.getByRole('button', { name: 'Node: Alpha' });
  const before = await alpha.boundingBox();
  expect(before).toBeTruthy();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 48, before!.y + before!.height / 2 + 18, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    const body = (await response.json()) as { source: string };
    return body.source.includes('%% mdve:position alpha') && body.source.includes('%% mdve:position beta');
  }).toBe(true);
});

test('preview context menu can create a link between nodes', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  start[Start]\n  done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await page.getByRole('button', { name: 'Node: Start' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Preview context menu' });
  await menu.getByRole('menuitem', { name: 'Start link' }).click();
  await expect(page.getByRole('status')).toContainText('Link from Start');
  await page.getByRole('button', { name: 'Node: Done' }).click();
  await expect(page.locator('path.mdve-hit[aria-label="Link: start to done"]')).toHaveCount(1);
  await expect(page.getByRole('status')).toBeHidden();
});

test('preview context menu edits and deletes a node', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  start[Start] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const node = page.getByRole('button', { name: 'Node: Start' });
  await node.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Preview context menu' });
  await expect(menu.getByRole('menuitem', { name: 'Edit label' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete node' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Edit label' }).click();

  const editor = page.getByRole('textbox', { name: 'Edit node label' });
  await expect(editor).toBeVisible();
  await editor.fill('Begin');
  await editor.press('Enter');
  await waitForSaved(page, 3);
  const renamedNode = page.getByRole('button', { name: 'Node: Begin' });
  await expect(renamedNode).toBeVisible();

  await renamedNode.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Delete node' }).click();
  await waitForSaved(page, 4);
  await expect(page.getByRole('button', { name: 'Node: Begin' })).toBeHidden();
});

test('preview context menu can delete a link', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  start[Start] --> done[Done]\n');
  await waitForSaved(page, 2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const link = page.locator('path.mdve-hit[aria-label="Link: start to done"]');
  await expect(link).toHaveCount(1);
  const linkBox = await link.boundingBox();
  expect(linkBox).toBeTruthy();
  await page.mouse.click(linkBox!.x + linkBox!.width / 2, linkBox!.y + linkBox!.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Preview context menu' });
  await expect(menu.getByRole('menuitem', { name: 'Delete link' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete link' }).click();

  await waitForSaved(page, 3);
  await expect(page.locator('.edgePaths path:not(.mdve-hit)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Node: Start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Node: Done' })).toBeVisible();
});

test('desktop panels can be collapsed and their dividers resized', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sourcePanel = page.locator('#workbench-source');
  const rightPanel = page.locator('#workbench-side');
  await expect(sourcePanel).toBeVisible();
  await expect(rightPanel).toBeVisible();

  const leftDivider = page.getByRole('separator', { name: 'Resize source panel' });
  const leftBefore = await sourcePanel.boundingBox();
  const leftDividerBox = await leftDivider.boundingBox();
  expect(leftBefore).toBeTruthy();
  expect(leftDividerBox).toBeTruthy();
  await page.mouse.move(leftDividerBox!.x + leftDividerBox!.width / 2, leftDividerBox!.y + leftDividerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(leftDividerBox!.x + leftDividerBox!.width / 2 + 96, leftDividerBox!.y + leftDividerBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await sourcePanel.boundingBox())?.width ?? 0).toBeGreaterThan((leftBefore!.width ?? 0) + 50);

  await page.getByRole('button', { name: 'Close source panel' }).click();
  await expect(sourcePanel).toBeHidden();
  await page.getByRole('button', { name: 'Open source panel' }).click();
  await expect(sourcePanel).toBeVisible();

  const rightDivider = page.getByRole('separator', { name: 'Resize right panel' });
  const rightBefore = await rightPanel.boundingBox();
  const rightDividerBox = await rightDivider.boundingBox();
  expect(rightBefore).toBeTruthy();
  expect(rightDividerBox).toBeTruthy();
  await page.mouse.move(rightDividerBox!.x + rightDividerBox!.width / 2, rightDividerBox!.y + rightDividerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rightDividerBox!.x + rightDividerBox!.width / 2 - 96, rightDividerBox!.y + rightDividerBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await rightPanel.boundingBox())?.width ?? 0).toBeGreaterThan((rightBefore!.width ?? 0) + 50);

  await page.getByRole('button', { name: 'Close right panel' }).click();
  await expect(rightPanel).toBeHidden();
  await page.getByRole('button', { name: 'Open right panel' }).click();
  await expect(rightPanel).toBeVisible();

  const persistedSourceWidth = (await sourcePanel.boundingBox())?.width ?? 0;
  const persistedRightWidth = (await rightPanel.boundingBox())?.width ?? 0;
  await page.waitForTimeout(180);
  await page.reload();
  await expect.poll(async () => (await sourcePanel.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(persistedSourceWidth - 1);
  await expect.poll(async () => (await rightPanel.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(persistedRightWidth - 1);
});

test('browser recovery drafts survive reload and can be promoted from a stale revision', async ({ page }) => {
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  const draft = 'flowchart TD\n  draft[Recovered draft] --> done[Done]\n';
  await seedRecoveryDraft(page, { sessionId: sessionId!, source: draft, baseRevision: 0 });

  await page.reload();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByText('Recovery draft available')).toBeVisible();
  await expect(page.locator('.cm-content')).not.toContainText('Recovered draft');

  await page.getByRole('button', { name: 'Use recovery draft' }).click();
  await waitForSaved(page, 2);
  const response = await page.request.get(`/api/sessions/${sessionId}`);
  expect((await response.json()).source).toBe(draft);
});

test('a same-revision recovery draft is restored into the editor after reload', async ({ page }) => {
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  const draft = 'flowchart TD\n  reload[Reloaded draft] --> done[Done]\n';
  await seedRecoveryDraft(page, { sessionId: sessionId!, source: draft, baseRevision: 1 });
  await page.route('**/api/sessions/*/diagram', (route) => route.abort());

  await page.reload();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Reloaded draft');
  await expect(page.getByText('Recovery draft available')).toBeVisible();
});

test('browser-process restart preserves a recovery draft', async ({ page }, testInfo) => {
  // This test starts two real persistent browser processes. Under the full
  // Chromium + Firefox stability sequence, Firefox startup can exceed the
  // ordinary 30-second single-page test budget without the journey itself
  // being stuck.
  testInfo.setTimeout(90_000);
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  const browser = page.context().browser();
  expect(browser).toBeTruthy();
  const browserType = browser!.browserType();
  const profile = testInfo.outputPath('browser-restart-profile', `${process.pid}-${Date.now()}`);
  const contextOptions = { baseURL: 'http://127.0.0.1:4187', headless: true, viewport: { width: 800, height: 900 } };
  const draft = 'flowchart TD\n  process[Process restart] --> done[Done]\n';
  const firstContext = await browserType.launchPersistentContext(profile, contextOptions);
  try {
    const firstPage = firstContext.pages()[0] ?? await firstContext.newPage();
    // Seed before the app opens its own recovery transaction. The readiness
    // endpoint keeps the origin identical without racing startup IndexedDB
    // work in this disposable browser profile.
    await firstPage.goto('/_mdve/ready');
    await firstPage.evaluate((id) => localStorage.setItem('mdve.session', id), sessionId);
    await seedRecoveryDraft(firstPage, { sessionId: sessionId!, source: draft, baseRevision: 0 });
  } finally {
    await firstContext.close();
  }

  const restartedContext = await browserType.launchPersistentContext(profile, contextOptions);
  try {
    const restartedPage = restartedContext.pages()[0] ?? await restartedContext.newPage();
    await restartedPage.goto('/');
    await restartedPage.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(restartedPage.getByText('Recovery draft available')).toBeVisible();
    await expect(restartedPage.locator('.cm-content')).not.toContainText('Process restart');
    await restartedPage.getByRole('button', { name: 'Use recovery draft' }).click();
    await waitForSaved(restartedPage, 2);
    const response = await page.request.get(`/api/sessions/${sessionId}`);
    expect((await response.json()).source).toBe(draft);
  } finally {
    await restartedContext.close();
  }
});

test('browser draft storage denial is visible', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'open', {
      configurable: true,
      value: () => { throw new DOMException('Storage denied', 'SecurityError'); },
    });
  });
  await page.reload();
  await expect(page.getByText('Draft recovery unavailable')).toBeVisible();
});

test('browser draft quota failure is visible', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      configurable: true,
      value: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    });
  });
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  quota[Quota] --> done[Done]\n');
  await expect(page.getByText('Draft recovery unavailable')).toBeVisible();
});
