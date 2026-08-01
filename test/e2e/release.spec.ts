import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function waitForSaved(page: Page, revision: number): Promise<void> {
  await expect(page.getByText(`Saved · revision ${revision}`)).toBeVisible({ timeout: 10_000 });
}

async function seedRecoveryDraft(page: Page, draft: { sessionId: string; source: string; baseRevision: number }): Promise<void> {
  await page.evaluate((value) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mdve-recovery', 1);
    request.onerror = () => reject(request.error ?? new Error('Could not open recovery database'));
    request.onsuccess = () => {
      const transaction = request.result.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').put({ ...value, updatedAt: Date.now() });
      transaction.oncomplete = () => {
        request.result.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not seed recovery draft'));
    };
  }), draft);
}

test.beforeEach(async ({ page }, testInfo) => {
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
  const menu = page.locator('summary').filter({ hasText: 'Diagram' });
  await menu.click();
  await page.getByRole('button', { name: 'New diagram' }).click();
  await waitForSaved(page, 1);

  await menu.click();
  await page.getByRole('button', { name: 'Archive diagram' }).click();
  await expect(page.locator('#diagram-select')).toHaveValue(/.+/);

  await page.getByLabel('Diagram library').selectOption('archived');
  await expect(page.locator('#diagram-select option').filter({ hasText: 'Untitled diagram (archived)' })).toHaveCount(1);
  const archivedId = await page.locator('#diagram-select option').filter({ hasText: 'Untitled diagram (archived)' }).getAttribute('value');
  expect(archivedId).toBeTruthy();
  await page.locator('#diagram-select').selectOption(archivedId!);
  await menu.click();
  await expect(page.getByRole('button', { name: 'Restore diagram' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore diagram' }).click();

  await menu.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move diagram to Trash' }).click();
  await page.getByLabel('Diagram library').selectOption('trash');
  await expect(page.locator('#diagram-select option').filter({ hasText: 'Untitled diagram (Trash)' })).toHaveCount(1);
  const trashedId = await page.locator('#diagram-select option').filter({ hasText: 'Untitled diagram (Trash)' }).getAttribute('value');
  expect(trashedId).toBeTruthy();
  await page.locator('#diagram-select').selectOption(trashedId!);
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
  const sessionId = await page.evaluate(() => localStorage.getItem('mdve.session'));
  expect(sessionId).toBeTruthy();
  const browser = page.context().browser();
  expect(browser).toBeTruthy();
  const browserType = browser!.browserType();
  const profile = testInfo.outputPath('browser-restart-profile');
  const contextOptions = { baseURL: 'http://127.0.0.1:4187', headless: true, viewport: { width: 800, height: 900 } };
  const draft = 'flowchart TD\n  process[Process restart] --> done[Done]\n';
  const firstContext = await browserType.launchPersistentContext(profile, contextOptions);
  try {
    const firstPage = firstContext.pages()[0] ?? await firstContext.newPage();
    await firstPage.goto('/');
    await firstPage.evaluate((id) => localStorage.setItem('mdve.session', id), sessionId);
    await firstPage.reload();
    await waitForSaved(firstPage, 1);
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
