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
  await expect.poll(() => stage.getAttribute('style')).not.toBe(beforeTransform);

  await page.waitForTimeout(120);
  const editBox = await node.boundingBox();
  expect(editBox).toBeTruthy();
  await page.mouse.click(editBox!.x + editBox!.width / 2, editBox!.y + editBox!.height / 2);
  const editor = page.getByRole('textbox', { name: 'Edit node label' });
  await expect(editor).toBeVisible();
  await editor.fill('Begin');
  await editor.press('Enter');
  await waitForSaved(page, 3);
  await expect(page.getByRole('button', { name: 'Node: Begin' })).toBeVisible();
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
