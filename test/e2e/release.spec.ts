import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function waitForSaved(page: Page, revision: number): Promise<void> {
  await expect(page.getByText(`Saved · revision ${revision}`)).toBeVisible({ timeout: 10_000 });
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
