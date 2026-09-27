import { test, expect } from '@playwright/test';

const errors = new WeakMap();
const step = async (page) => Number(await page.locator('#movement-step-count').textContent());
const snapshot = async (page) => ({
  step: await step(page),
  positions: await page.locator('#movement-table [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  chart: await page.locator('#movement-chart').innerHTML(),
  clearance: await page.locator('#movement-clearance').textContent(),
});
const readingSnapshot = async (page) => ({
  ...await snapshot(page),
  table: await page.locator('#movement-table').innerHTML(),
  vectors: await page.locator('#movement-vectors').innerHTML(),
  inputs: await page.locator('#movement-inputs').textContent(),
  status: await page.locator('#movement-status').textContent(),
  outcome: await page.locator('#movement-outcome').textContent(),
  selection: await page.locator('#movement-agent').inputValue(),
  map: await page.locator('#movement-preset').inputValue(),
  drafts: await page.locator('#movement-gains input').evaluateAll((inputs) => inputs.map((input) => [input.id, input.value])),
  gainLabels: await page.locator('#movement-gains output').allTextContents(),
});

test.beforeEach(async ({ page }) => {
  const collected = [];
  errors.set(page, collected);
  page.on('pageerror', (error) => collected.push(error.message));
  await page.goto('/movement/');
  await expect(page.locator('#movement-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

test('workshop navigation exposes both algorithms and starts fresh runs', async ({ page }) => {
  await expect(page.locator('h1')).toContainText('Artificial Potential Fields');
  await page.locator('#movement-step').click();
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('combobox', { name: 'Choose a workshop', exact: true }).selectOption('/consensus/');
  await expect(page.locator('#step-count')).toHaveText('0');
  await expect(page.locator('#state-table tbody tr')).toHaveCount(6);
  await page.locator('#step-button').click();
  await expect(page.locator('#step-count')).toHaveText('1');
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('combobox', { name: 'Choose a workshop', exact: true }).selectOption('/movement/');
  await expect(page.locator('#movement-step-count')).toHaveText('0');
});

test('step, playback, map and applied gains have explicit reset semantics', async ({ page }) => {
  await page.locator('#movement-step').click();
  await expect(page.locator('#movement-time')).toHaveText('0.02 s');
  await expect(page.locator('[data-position-x="1"]')).toHaveText('-3.9800');
  await page.locator('#movement-speed').selectOption('200');
  await page.locator('#movement-play').click();
  await expect.poll(() => step(page)).toBeGreaterThan(1);
  await page.locator('#movement-play').click();
  const paused = await snapshot(page);
  await page.waitForTimeout(120);
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#gain-obstacle').fill('0.2');
  expect(await snapshot(page)).toEqual(paused);
  await page.getByRole('button', { name: 'Apply gains & reset' }).click();
  await expect(page.locator('#movement-step-count')).toHaveText('0');
  await page.locator('#movement-step').click();
  await page.locator('#gain-obstacle').fill('0.3');
  await page.locator('#movement-reset').click();
  await expect(page.locator('#gain-obstacle')).toHaveValue('0.2');
  await page.locator('#movement-preset').selectOption('trap');
  await expect(page.locator('#movement-status')).toHaveText('Paused');
  await expect(page.locator('#movement-map-name')).toHaveText('U-shaped trap');
  await expect(page.locator('#gain-obstacle')).toHaveValue('0.2');
});

test('nominal arrival and both failure types are visible and stop the run', async ({ page }) => {
  await page.locator('#movement-finish').click();
  await expect(page.locator('#movement-status')).toHaveText('Arrived');
  await expect(page.locator('#movement-arrived')).toHaveText('3 / 3');
  await expect(page.locator('#movement-step-count')).toHaveText('407');
  await expect(page.locator('#movement-play')).toBeDisabled();
  await page.locator('[data-movement-case="trap"]').click();
  await page.locator('#movement-finish').click();
  await expect(page.locator('#movement-status')).toHaveText('Stalled');
  await expect(page.locator('#movement-step-count')).toHaveText('330');
  await expect(page.locator('#movement-arrived')).toHaveText('0 / 3');
  await expect(page.locator('#movement-step')).toBeDisabled();
  for (const scenario of ['no-separation', 'no-obstacles']) {
    await page.locator(`[data-movement-case="${scenario}"]`).click();
    await expect(page.locator('#movement-step-count')).toHaveText('0');
    await page.locator('#movement-finish').click();
    await expect(page.locator('#movement-status')).toHaveText('Collision');
    await expect(page.locator('#movement-vectors')).toContainText('Command stopped');
    await expect(page.locator('#movement-finish')).toBeDisabled();
  }
  const beforeComparisons = await snapshot(page);
  await page.locator('#movement-comparisons summary').click();
  await expect(page.locator('#movement-comparison-table tr')).toHaveCount(5);
  expect(await snapshot(page)).toEqual(beforeComparisons);
});

test('view switches, camera orbit and playback setting preserve numerical state', async ({ page }) => {
  await page.locator('#movement-step').click();
  const before = await snapshot(page);
  await page.locator('#movement-3d').click();
  const canvas = page.locator('#movement-viewport canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#movement-camera-follow').click();
  await expect(page.locator('#movement-camera-follow')).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#movement-camera-whole').click();
  await expect(page.locator('#movement-camera-whole')).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toEqual(before);
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('.movement-3d-labels button')).toHaveCount(3);
  const labels = () => page.locator('.movement-3d-labels button').evaluateAll((items) => items.map((item) => [item.style.left, item.style.top]));
  const previousLabels = await labels();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect.poll(labels).not.toEqual(previousLabels);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#movement-2d').click();
  await expect(canvas).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#movement-speed').selectOption('10');
  await page.locator('#movement-step').click();
  const slow = await snapshot(page);
  await page.locator('#movement-reset').click();
  await page.locator('#movement-speed').selectOption('200');
  await page.locator('#movement-step').click();
  await page.locator('#movement-step').click();
  expect(await snapshot(page)).toEqual(slow);
});

test('keyboard and narrow-screen controls expose decisions without horizontal page overflow', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  const agent = page.locator('[data-movement-agent="2"]');
  await agent.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#movement-selected-name')).toHaveText('A3');
  await expect(agent).toBeFocused();
  await expect(page.locator('#movement-inputs')).toContainText('sensed peers: A2');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#movement-agent').selectOption('1');
  await expect(page.locator('#movement-inputs')).toContainText('sensed peers: A1, A3');
  await page.locator('#movement-step').click();
  await expect(page.locator('#movement-step-count')).toHaveText('1');
});

test('2D and textual controls remain usable when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.reload();
  await page.locator('#movement-3d').click();
  await expect(page.locator('#movement-viewport')).toContainText(/unavailable/i);
  await page.locator('#movement-2d').click();
  await page.locator('#movement-finish').click();
  await expect(page.locator('#movement-status')).toHaveText('Arrived');
  await expect(page.locator('[data-position-x="1"]')).toBeVisible();
});

test('reading method and model details preserves the run, inspected decision and draft gains', async ({ page }) => {
  await page.locator('#gain-obstacle').fill('0.3');
  await page.getByRole('button', { name: 'Apply gains & reset' }).click();
  await page.locator('#movement-step').click();
  await page.locator('#movement-step').click();
  await page.locator('#movement-agent').selectOption('2');
  await page.locator('#gain-obstacle').fill('0.4');
  await page.locator('#gain-separation').fill('0.045');
  const beforeReading = await readingSnapshot(page);
  expect(beforeReading.step).toBe(2);
  expect(beforeReading.selection).toBe('2');
  expect(beforeReading.status).toBe('Paused');

  for (const id of ['movement-method-details', 'movement-model-details']) {
    const disclosure = page.locator(`#${id}`);
    await expect(disclosure).not.toHaveAttribute('open', '');
    await disclosure.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('open', '');
    expect(await readingSnapshot(page)).toEqual(beforeReading);
    await page.keyboard.press('Space');
    await expect(disclosure).not.toHaveAttribute('open', '');
    expect(await readingSnapshot(page)).toEqual(beforeReading);
  }

  await page.locator('#movement-step').click();
  await expect(page.locator('#movement-step-count')).toHaveText('3');
  await expect(page.locator('#gain-obstacle')).toHaveValue('0.4');
  await page.locator('#movement-reset').click();
  await expect(page.locator('#gain-obstacle')).toHaveValue('0.3');
  await expect(page.locator('#gain-separation')).toHaveValue('0.02');
});

test('bookmarks reveal hidden comparisons and equations without changing the active experiment', async ({ page }) => {
  await page.goto('/movement/#movement-comparison-table');
  await expect(page.locator('#movement-comparisons')).toHaveAttribute('open', '');
  await expect(page.locator('#movement-comparison-table')).toBeVisible();
  await expect(page.locator('#movement-comparison-table tr')).toHaveCount(5);
  await expect(page.locator('#movement-comparison-table')).toContainText('Stalled');
  await expect(page.locator('#movement-comparison-table')).toContainText('Collision');

  await page.locator('#movement-step').click();
  await page.locator('#gain-attraction').fill('0.9');
  const beforeHashChange = await readingSnapshot(page);
  await page.evaluate(() => { window.location.hash = 'movement-equation'; });
  await expect(page.locator('#movement-model-details')).toHaveAttribute('open', '');
  await expect(page.locator('#movement-equation')).toBeVisible();
  expect(await readingSnapshot(page)).toEqual(beforeHashChange);

  await page.reload();
  await expect(page.locator('#movement-model-details')).toHaveAttribute('open', '');
  await expect(page.locator('#movement-equation')).toBeVisible();
  await expect(page.locator('#movement-step-count')).toHaveText('0');
  await expect(page.locator('#gain-attraction')).toHaveValue('0.6');
});

test('the lesson and native technical disclosures remain readable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const stylesheetRequests = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'stylesheet' && response.ok()) stylesheetRequests.push(response.url());
    });
    await page.goto('/movement/');
    await expect(page.locator('#movement-title')).toContainText('Artificial Potential Fields');
    await expect(page.locator('.movement-example')).toBeVisible();
    await expect(page.locator('#movement-example-caption')).toContainText('A2 at the start of the corridor');
    await expect(page.locator('.no-script-note')).toContainText('JavaScript');
    await expect(page.locator('.no-script-note')).toBeVisible();
    expect(stylesheetRequests.some((url) => /\/(?:lesson|movement[^/]*)\.css(?:\?|$)/.test(url))).toBe(true);

    await page.locator('#movement-method-details > summary').click();
    await expect(page.locator('#movement-method-details')).toHaveAttribute('open', '');
    await expect(page.locator('#movement-method-details')).toContainText(/synchronous/i);
    await page.locator('#movement-model-details > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#movement-equation')).toBeVisible();
    await expect(page.locator('#movement-equation')).toContainText('0.02');
    await expect(page.locator('#movement-model .reference a')).toHaveAttribute('href', 'https://khatib.stanford.edu/publications/pdfs/Khatib_1986_IJRR.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});
