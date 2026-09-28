import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const snapshot = async (page) => ({
  round: await page.locator('#fusion-round').textContent(),
  state: await page.locator('#fusion-states [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  traffic: await page.locator('#fusion-traffic').textContent(),
  update: await page.locator('#fusion-update').innerHTML(),
  coefficients: await page.locator('[data-fusion-coefficient]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
});
const readingSnapshot = async (page) => ({
  ...await snapshot(page),
  method: await page.locator('#fusion-algorithm').inputValue(),
  schedule: await page.locator('#fusion-schedule').inputValue(),
  observer: await page.locator('#fusion-observer').inputValue(),
  seedDraft: await page.locator('#fusion-seed').inputValue(),
  seedError: await page.locator('#fusion-seed-error').textContent(),
  status: await page.locator('#fusion-status').textContent(),
  outcome: await page.locator('#fusion-outcome').textContent(),
  updateKind: await page.locator('#fusion-update-kind').textContent(),
  ledger: await page.locator('#fusion-ledger').innerHTML(),
  ledgerChange: await page.locator('#fusion-ledger-change').textContent(),
  evaluation: await page.locator('#fusion-evaluation').innerHTML(),
  links: await page.locator('[data-fusion-link]').evaluateAll((items) => items.map((item) => [item.dataset.fusionLink, item.dataset.available])),
  geometry: await page.locator('[data-fusion-contour], [data-fusion-trail], [data-fusion-truth], [data-fusion-estimate]').evaluateAll((items) => items.map((item) => item.outerHTML)),
});
const means = async (page) => page.locator('#fusion-states tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].slice(0, 2).map((cell) => cell.dataset.rawValue)));
async function freezeClock(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
}
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/fusion/'); await expect(page.locator('#fusion-round')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('overlap appears at round two and naive summaries understate uncertainty without new observations', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Shared estimates.');
  await expect(page.locator('#fusion-reported')).toHaveText('1.280000 m²');
  await expect(page.locator('[data-fusion-estimate]')).toHaveCount(3);
  await expect(page.locator('#fusion-viewport canvas')).toHaveCount(0);
  await page.locator('#fusion-step').click();
  await expect(page.locator('#fusion-ratio')).toHaveText('1.00×');
  await expect(page.locator('#fusion-update-kind')).toContainText("receives A3's round-0 state");
  await page.locator('#fusion-round-two').click();
  await expect(page.locator('#fusion-round')).toHaveText('2');
  await expect(page.locator('#fusion-reported')).toHaveText('0.320000 m²');
  await expect(page.locator('#fusion-expected')).toHaveText('0.480000 m²');
  await expect(page.locator('#fusion-ratio')).toHaveText('1.50×');
  await expect(page.locator('#fusion-payload-note')).toContainText('no original IDs');
  await expect(page.locator('#fusion-lineage-note')).toContainText('3 of 3');
  await page.locator('#fusion-finish').click();
  await expect(page.locator('#fusion-status')).toHaveText('12-round window complete');
  await expect(page.locator('#fusion-ratio')).toHaveText('1365.33×');
  await expect(page.locator('#fusion-step')).toBeDisabled();
  await expect(page.locator('#fusion-outcome')).toContainText('No sensor has taken a new reading');
});

test('unique raw IDs stop repeated fusion while CI keeps the same ring means with conservative covariance', async ({ page }) => {
  await page.locator('#fusion-finish').click(); const naive = await means(page);
  await page.locator('[data-fusion-case="ci:ring"]').click(); await page.locator('#fusion-finish').click();
  expect(await means(page)).toEqual(naive);
  await expect(page.locator('#fusion-reported')).toHaveText('1.280000 m²');
  await expect(page.locator('#fusion-ratio')).toHaveText('0.33×');
  await expect(page.locator('#fusion-ledger')).toContainText('No shared original-ID records');
  await page.locator('[data-fusion-case="ledger:ring"]').click(); await page.locator('#fusion-round-two').click();
  await expect(page.locator('#fusion-ledger tr')).toHaveCount(3);
  await expect(page.locator('#fusion-reported')).toHaveText('0.426667 m²');
  await expect(page.locator('#fusion-ratio')).toHaveText('1.00×');
  const atTwo = await means(page);
  await page.locator('#fusion-step').click();
  await expect(page.locator('#fusion-ledger-change')).toContainText('New IDs this round: none. Repeated IDs ignored: z1, z2, z3.');
  expect(await means(page)).toEqual(atTwo);
  await page.locator('#fusion-finish').click(); expect(await means(page)).toEqual(atTwo);
  await expect(page.locator('#fusion-traffic')).toContainText('99 delivered records');
});

test('cut packets are absent from local updates and round-five recovery does not replay the backlog', async ({ page }) => {
  await page.locator('[data-fusion-case="ledger:recovery"]').click();
  for (let round = 0; round < 4; round += 1) await page.locator('#fusion-step').click();
  await expect(page.locator('#fusion-update-kind')).toContainText('no packet delivered from A3');
  await expect(page.locator('#fusion-ledger tr')).toHaveCount(1);
  await expect(page.locator('#fusion-update dd').nth(2)).toHaveText('—');
  await expect(page.locator('[data-fusion-link="2"]')).toHaveAttribute('data-available', 'false');
  await expect(page.locator('#fusion-traffic')).toContainText('12 packets attempted · 8 delivered · 4 dropped');
  await page.locator('#fusion-restore').click();
  await expect(page.locator('#fusion-round')).toHaveText('5');
  await expect(page.locator('[data-fusion-link="2"]')).toHaveAttribute('data-available', 'true');
  await expect(page.locator('#fusion-update-kind')).toContainText("receives A3's round-4 state");
  await expect(page.locator('#fusion-traffic')).toContainText('15 packets attempted · 11 delivered · 4 dropped');
  await expect(page.locator('#fusion-ledger tr')).toHaveCount(3);
  await page.locator('#fusion-observer').selectOption('1'); await expect(page.locator('#fusion-ledger tr')).toHaveCount(2);
  await page.locator('#fusion-step').click(); await expect(page.locator('#fusion-ledger tr')).toHaveCount(3);
  await page.locator('#fusion-algorithm').selectOption('local'); await page.locator('#fusion-finish').click();
  await expect(page.locator('#fusion-traffic')).toHaveText('0 packets attempted · 0 delivered · 0 dropped · 0 delivered records');
});

test('applied seeds replay exactly and paired comparison tables never replace the active run', async ({ page }) => {
  await page.locator('#fusion-step').click(); const one = await snapshot(page);
  await page.locator('#fusion-seed').fill('7'); expect(await snapshot(page)).toEqual(one);
  await page.locator('#fusion-reset').click(); await expect(page.locator('#fusion-seed')).toHaveValue('1');
  await page.locator('#fusion-step').click(); expect(await snapshot(page)).toEqual(one);
  await page.locator('#fusion-seed').fill('7'); await page.locator('#fusion-seed-form button').click();
  await expect(page.locator('#fusion-round')).toHaveText('0'); await page.locator('#fusion-step').click();
  const seven = await snapshot(page); expect(seven.state).not.toEqual(one.state);
  await page.locator('#fusion-reset').click(); await page.locator('#fusion-step').click(); expect(await snapshot(page)).toEqual(seven);
  await page.locator('#fusion-seed').fill('0'); await page.locator('#fusion-seed-form button').click(); expect(await snapshot(page)).toEqual(seven);
  await page.locator('#fusion-comparisons summary').click();
  await expect(page.locator('#fusion-reference-table tr')).toHaveCount(10);
  await expect(page.locator('#fusion-seed-table tr')).toHaveCount(10);
  await expect(page.locator('#fusion-reference-table tr').nth(1)).toContainText('1365.3335');
  expect(await snapshot(page)).toEqual(seven);
});

test('playback speed, observer and 2D/3D camera changes preserve the same run, including context loss', async ({ page }) => {
  await freezeClock(page); await page.locator('#fusion-speed').selectOption('1');
  await page.locator('#fusion-play').click(); await page.clock.runFor(2000); await page.locator('#fusion-play').click();
  const slow = await snapshot(page); expect(slow.round).toBe('2');
  await page.locator('#fusion-reset').click(); await page.locator('#fusion-speed').selectOption('8');
  await page.locator('#fusion-play').click(); await page.clock.runFor(250); await page.locator('#fusion-play').click();
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#fusion-observer').selectOption('2'); await page.locator('#fusion-observer').selectOption('0'); expect(await snapshot(page)).toEqual(slow);
  await page.locator('#fusion-3d').click(); const canvas = page.locator('#fusion-viewport canvas'); await expect(canvas).toBeVisible();
  await page.locator('#fusion-camera-follow').click();
  await expect(page.locator('#fusion-camera-follow')).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#fusion-camera-whole').click();
  await expect(page.locator('#fusion-camera-whole')).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toEqual(slow);
  await expect(page.locator('.fusion-agent-label')).toHaveCount(3);
  const positions = () => page.locator('.fusion-agent-label').evaluateAll((items) => items.map((item) => [item.style.left, item.style.top]));
  const before = await positions(), bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .5, { steps: 6 }); await page.mouse.up();
  await expect.poll(positions).not.toEqual(before); expect(await snapshot(page)).toEqual(slow);
  await canvas.dispatchEvent('webglcontextlost'); await expect(page.locator('#fusion-viewport')).toContainText('3D context lost');
  await page.locator('#fusion-2d').click(); await expect(page.locator('.fusion-svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(slow); await page.locator('#fusion-step').click(); await expect(page.locator('#fusion-round')).toHaveText('3');
});

test('keyboard, narrow layout, workshop navigation and unavailable WebGL remain usable', async ({ page }) => {
  await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused(); await page.keyboard.press('Enter');
  await page.locator('#fusion-algorithm').focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(page.locator('#fusion-algorithm')).toHaveValue('local');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true }).locator('option')).toHaveCount(23);
  await navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true }).selectOption('/localization/'); await expect(page.locator('#loc-step-count')).toHaveText('0');
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('combobox', { name: 'Choose a workshop', exact: true }).selectOption('/fusion/');
  await expect(page).toHaveURL('/fusion/');
  await expect(page.locator('#fusion-round')).toHaveText('0');
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await page.locator('#fusion-3d').click(); await expect(page.locator('#fusion-viewport')).toContainText('3D is unavailable');
  await page.locator('#fusion-2d').click(); await page.locator('#fusion-finish').click();
  await expect(page.locator('#fusion-round')).toHaveText('12'); await expect(page.locator('#fusion-ratio')).toHaveText('1365.33×');
});

test('reading disclosures preserves packet recovery, the inspected agent and an unapplied seed', async ({ page }) => {
  await page.locator('[data-fusion-case="ledger:recovery"]').click();
  await page.locator('#fusion-observer').selectOption('1');
  await page.locator('#fusion-seed').fill('7');
  for (let round = 0; round < 4; round += 1) await page.locator('#fusion-step').click();

  for (const phase of [{ round: '4', available: 'false' }, { round: '5', available: 'true' }]) {
    if (phase.round === '5') await page.locator('#fusion-restore').click();
    await expect(page.locator('#fusion-round')).toHaveText(phase.round);
    await expect(page.locator('[data-fusion-link="2"]')).toHaveAttribute('data-available', phase.available);
    const beforeReading = await readingSnapshot(page);
    expect(beforeReading.observer).toBe('1');
    expect(beforeReading.seedDraft).toBe('7');
    expect(beforeReading.status).toBe('Paused');

    for (const id of ['fusion-method-details', 'fusion-model-details']) {
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
  }

  const recovered = await snapshot(page);
  await page.locator('#fusion-reset').click();
  await expect(page.locator('#fusion-seed')).toHaveValue('1');
  await expect(page.locator('#fusion-observer')).toHaveValue('1');
  await page.locator('#fusion-restore').click();
  expect(await snapshot(page)).toEqual(recovered);
  await page.locator('#fusion-step').click();
  await expect(page.locator('#fusion-round')).toHaveText('6');
  await expect(page.locator('#fusion-ledger tr')).toHaveCount(3);
});

test('bookmarks reveal comparisons and fusion equations without replacing an active run', async ({ page }) => {
  await page.goto('/fusion/#fusion-seed-table');
  await expect(page.locator('#fusion-comparisons')).toHaveAttribute('open', '');
  await expect(page.locator('#fusion-seed-table')).toBeVisible();
  await expect(page.locator('#fusion-reference-table tr')).toHaveCount(10);
  await expect(page.locator('#fusion-seed-table tr')).toHaveCount(10);
  await expect(page.locator('#fusion-reference-table tr').nth(1)).toContainText('1365.3335');

  await page.locator('#fusion-seed').fill('7');
  await page.locator('#fusion-seed-form button').click();
  await page.locator('#fusion-observer').selectOption('2');
  await page.locator('#fusion-round-two').click();
  await page.locator('#fusion-seed').fill('11');
  const beforeHashChange = await readingSnapshot(page);
  expect(beforeHashChange.round).toBe('2');
  expect(beforeHashChange.observer).toBe('2');
  expect(beforeHashChange.seedDraft).toBe('11');
  await page.evaluate(() => { window.location.hash = 'fusion-equation'; });
  await expect(page.locator('#fusion-model-details')).toHaveAttribute('open', '');
  await expect(page.locator('#fusion-equation')).toBeVisible();
  expect(await readingSnapshot(page)).toEqual(beforeHashChange);

  const appliedRun = await snapshot(page);
  await page.locator('#fusion-reset').click();
  await expect(page.locator('#fusion-seed')).toHaveValue('7');
  await page.locator('#fusion-round-two').click();
  expect(await snapshot(page)).toEqual(appliedRun);
  await page.reload();
  await expect(page.locator('#fusion-model-details')).toHaveAttribute('open', '');
  await expect(page.locator('#fusion-equation')).toBeVisible();
  await expect(page.locator('#fusion-round')).toHaveText('0');
  await expect(page.locator('#fusion-algorithm')).toHaveValue('naive');
  await expect(page.locator('#fusion-schedule')).toHaveValue('ring');
  await expect(page.locator('#fusion-observer')).toHaveValue('0');
  await expect(page.locator('#fusion-seed')).toHaveValue('1');
});

test('the static lesson, fusion rules and sources remain readable on mobile without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const stylesheets = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'stylesheet' && response.ok()) stylesheets.push(response.url());
    });
    await page.goto('/fusion/');
    await expect(page.locator('h1')).toHaveText('Shared estimates.');
    await expect(page.locator('.no-script-note')).toBeVisible();
    await expect(page.locator('.no-script-note')).toContainText('JavaScript');
    for (const name of ['lesson', 'fusion']) {
      expect(stylesheets.some((url) => new URL(url).pathname === `/src/${name}.css`)).toBe(true);
    }
    await page.locator('#fusion-method-details > summary').click();
    await expect(page.locator('#fusion-method-details')).toHaveAttribute('open', '');
    await expect(page.locator('#fusion-method-details')).toContainText('Three readings, one browser');
    await page.locator('#fusion-model-details > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#fusion-equation')).toBeVisible();
    await expect(page.locator('#fusion-equation')).toContainText('P⁺ = (Pₐ⁻¹ + Pᵦ⁻¹)⁻¹');
    await expect(page.locator('#fusion-equation')).toContainText('P⁺ = (ωPₐ⁻¹ + (1 − ω)Pᵦ⁻¹)⁻¹');
    await expect(page.locator('#fusion-method .reference a').nth(0)).toHaveAttribute('href', 'https://doi.org/10.1109/ACC.1997.609105');
    await expect(page.locator('#fusion-method .reference a').nth(1)).toHaveAttribute('href', 'https://publikationen.bibliothek.kit.edu/1000067530/179593312');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});
