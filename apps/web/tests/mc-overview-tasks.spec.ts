import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/page-errors.js';

// The engineer tasks from the workbench usability protocol (#177), as regression checks. Each task
// must stay completable within a small interaction budget. This is a proxy for, not a replacement of,
// sessions with engineers: it catches regressions and buried actions, not misreadings.
const fixture = new URL('./fixtures/four-wire-limits.bmopf.json', import.meta.url);

async function solvedOverview(page: Page) {
	await page.route('**/api/cases', (route) => route.fulfill({ json: [] }));
	await page.goto('/');
	// The prerendered input exists before hydration attaches its listener; a file set earlier is
	// lost. The empty-cases panel renders only after load.
	await expect(page.getByText('no default cases loaded')).toBeVisible();
	await page.locator('input[type=file]').setInputFiles({
		name: 'four-wire-limits.bmopf.json',
		mimeType: 'application/json',
		buffer: await readFile(fixture)
	});
	const solve = page.getByRole('button', { name: 'Solve AC power flow', exact: true });
	await expect(solve).toBeEnabled({ timeout: 60_000 });
	await solve.click();
	const overview = page.getByRole('region', { name: 'Operating point overview' });
	await expect(overview.locator('.issues button').first()).toBeVisible({ timeout: 60_000 });
	return overview;
}

test('protocol tasks stay within their interaction budgets', async ({ page }) => {
	const overview = await solvedOverview(page);
	const issues = overview.locator('.issues button');

	await test.step('1. the most serious problem is visible without interaction', async () => {
		await expect(issues.first()).toContainText('lb');
		await expect(overview.getByRole('button', { name: /Violations/ })).toContainText('1');
	});
	await test.step('2. its size and phase are visible without interaction', async () => {
		await expect(issues.first()).toContainText('c–n below 207.00 V by 1.72 %');
	});
	await test.step('3. follow the voltage to it: one click', async () => {
		await issues.first().click();
		await expect(overview.getByRole('heading', { name: 'Voltage profile' })).toBeVisible();
		await expect(overview).toContainText('src → lb · 2 buses');
	});
	await test.step('4. the most heavily loaded line: one click', async () => {
		await overview.getByRole('button', { name: /Max loading/ }).click();
		await expect(overview.getByRole('heading', { name: 'Conductors on l1' })).toBeVisible();
	});
	await test.step('5. why it is loaded: visible without further interaction', async () => {
		await expect(
			overview.getByRole('list', { name: 'From end conductor currents' }).getByRole('listitem')
		).toHaveCount(4);
		await expect(overview).toContainText('neutral carries');
	});
	await test.step('6. find a named bus: type and Enter', async () => {
		await overview.getByRole('combobox', { name: 'Find a bus or branch' }).fill('src');
		await page.keyboard.press('Enter');
		await expect(overview.getByRole('heading', { name: 'Phases at src' })).toBeVisible();
	});
	await test.step('9. results for a report: one click', async () => {
		const download = page.waitForEvent('download');
		await overview.getByRole('button', { name: 'Branch CSV' }).click();
		expect((await download).suggestedFilename()).toMatch(/branches\.csv$/);
	});
});

test('7. switch to the schematic and between layouts, keeping the selection', async ({ page }) => {
	const overview = await solvedOverview(page);
	await overview.locator('.issues button').first().click();
	await overview.getByRole('button', { name: 'Show schematic' }).click();
	const schematic = page.getByRole('application', { name: 'Schematic diagram' });
	await expect(schematic).toBeVisible();
	const toolbar = page.getByRole('toolbar', { name: 'Schematic' });
	await toolbar.getByRole('combobox', { name: 'Schematic arrangement' }).selectOption('leaf-order');
	await toolbar.getByRole('combobox', { name: 'Schematic arrangement' }).selectOption('tidy');
	await toolbar.getByRole('combobox', { name: 'Colour by' }).selectOption('loading-heat');
	await expect(page.getByText('≥ 100 %')).toBeVisible();
	await toolbar.getByRole('button', { name: /Geographic|Source positions/ }).click();
	await expect(
		toolbar.getByRole('button', { name: /Geographic|Source positions/ })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(overview.getByRole('heading', { name: 'Phases at lb' })).toBeVisible();
	for (const [name, extension] of [
		['PNG', 'png'],
		['SVG', 'svg']
	] as const) {
		const download = page.waitForEvent('download');
		await toolbar.getByRole('button', { name, exact: true }).click();
		expect((await download).suggestedFilename()).toMatch(new RegExp(`schematic\\.${extension}$`));
	}
	await toolbar.getByRole('button', { name: 'Close' }).click();
	await expect(schematic).toHaveCount(0);
});

test('the schematic draws equipment symbols with a legend, and hides them when too small', async ({
	page
}) => {
	const overview = await solvedOverview(page);
	await overview.getByRole('button', { name: 'Show schematic' }).click();
	const legend = page.getByRole('list', { name: 'Symbols' });
	await expect(legend).toBeVisible();
	await expect(legend.getByRole('listitem')).toHaveText([
		'phases, ○ neutral',
		'active power flow',
		'source',
		'load',
		'shunt'
	]);
	// Zoomed far out, symbols would be specks: the plain lines carry the drawing instead.
	await page.getByRole('application', { name: 'Schematic diagram' }).focus();
	for (let i = 0; i < 8; i++) await page.keyboard.press('-');
	await expect(legend).toHaveCount(0);

	// Selecting from the overview flies to the selection and zooms until symbols are legible.
	await overview.locator('.issues button', { hasText: 'l1' }).click();
	await expect(legend).toBeVisible();
});

test('the schematic can be walked bus by bus from the keyboard', async ({ page }) => {
	const overview = await solvedOverview(page);
	await overview.getByRole('button', { name: 'Show schematic' }).click();
	const schematic = page.getByRole('application', { name: 'Schematic diagram' });
	await expect(page.getByRole('list', { name: 'Symbols' })).toBeVisible();
	await schematic.focus();
	const spoken = schematic.locator('[aria-live]');
	await page.keyboard.press('ArrowRight');
	await expect(spoken).toHaveText(/^src: source bus\. 1 branch onward\. 1 source, 1 shunt/);
	await page.keyboard.press('ArrowRight');
	await expect(spoken).toHaveText(
		/^lb: 1 step from src, fed by line l1\. 0 branches onward\. 3 loads\. Worst voltage c–n 203\.4 V, outside 207\.0 V to 253\.0 V/
	);
	await page.keyboard.press('Enter');
	await expect(overview.getByRole('heading', { name: 'Phases at lb' })).toBeVisible();
	await page.keyboard.press('ArrowLeft');
	await expect(spoken).toHaveText(/^src: /);
	await page.keyboard.press('Escape');
	await expect(spoken).toHaveText('');
});

test('hovering a table row highlights the bus in the voltage profile', async ({ page }) => {
	const overview = await solvedOverview(page);
	await overview.locator('.issues button').first().click();
	await overview.getByText('Results table').click();
	await overview.getByRole('row').filter({ hasText: /^src/ }).first().hover();
	await expect(overview.locator('circle.point.hovered').first()).toBeAttached();
	await overview.getByRole('heading', { name: 'Phases at lb' }).hover();
	await expect(overview.locator('circle.point.hovered')).toHaveCount(0);
});

test('8. a link reopens the saved study with its selection and view', async ({ page, context }) => {
	const overview = await solvedOverview(page);
	await overview.locator('.issues button').first().click();
	await overview.getByRole('button', { name: 'Show schematic' }).click();
	await page.getByRole('button', { name: 'Save result' }).click();
	await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(/[?&]study=[^&]+.*sel=bus%3Alb|sel=bus%3Alb.*study=/);
	await expect(page).toHaveURL(/view=schematic/);

	const reopened = await context.newPage();
	await reopened.route('**/api/cases', (route) => route.fulfill({ json: [] }));
	await reopened.goto(page.url());
	const restored = reopened.getByRole('region', { name: 'Operating point overview' });
	await expect(restored.getByRole('heading', { name: 'Phases at lb' })).toBeVisible({
		timeout: 60_000
	});
	await expect(reopened.getByRole('application', { name: 'Schematic diagram' })).toBeVisible();
});

test('the overview works from the keyboard alone', async ({ page }) => {
	const overview = await solvedOverview(page);
	const search = overview.getByRole('combobox', { name: 'Find a bus or branch' });
	await search.focus();
	await page.keyboard.type('lb');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(overview.getByRole('heading', { name: 'Phases at lb' })).toBeVisible();

	// The profile is one Tab stop; arrow keys walk the path and Enter selects.
	const points = overview.locator('figure [role=button]');
	await expect(points).toHaveCount(6);
	await expect(overview.locator('figure [role=button][tabindex="0"]')).toHaveCount(1);
	await overview.locator('figure [role=button][tabindex="0"]').focus();
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^src /);
	await page.keyboard.press('Enter');
	await expect(overview.getByRole('heading', { name: 'Phases at src' })).toBeVisible();

	// The table grid follows the shared selection and moves it with arrow keys.
	await overview.getByText('Results table').click();
	const grid = overview.getByRole('grid', { name: 'Bus results' });
	await grid.focus();
	await page.keyboard.press('Home');
	await expect(grid.locator('[role=row][aria-selected=true]')).toHaveCount(1);
	await page.keyboard.press('ArrowDown');
	await expect(overview.getByRole('heading', { name: /^Phases at / })).toBeVisible();
});

test('every overview control has an accessible name', async ({ page }) => {
	const overview = await solvedOverview(page);
	await overview.locator('.issues button').first().click();
	await overview.getByText('Results table').click();
	const unnamed = await overview.evaluate((root) =>
		[
			...root.querySelectorAll<HTMLElement | SVGElement>(
				'button, input, select, summary, [role=button], [role=tab], [role=grid], [tabindex="0"]'
			)
		]
			.filter((el) => {
				const label = (el as HTMLInputElement).labels?.length;
				const text = el.textContent?.trim();
				return (
					!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !label && !text
				);
			})
			.map((el) => el.outerHTML.slice(0, 120))
	);
	expect(unnamed).toEqual([]);
});

test('the schematic layout file loads back with the case as its diagram', async ({
	page,
	context
}) => {
	const overview = await solvedOverview(page);
	await overview.getByRole('button', { name: 'Show schematic' }).click();
	const toolbar = page.getByRole('toolbar', { name: 'Schematic' });
	const download = page.waitForEvent('download');
	await toolbar.getByRole('button', { name: 'Layout', exact: true }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/schematic\.geo\.json$/);
	const layer = await readFile(await file.path(), 'utf8');
	const parsed = JSON.parse(layer);
	expect(parsed.powerio_geo).toEqual({ space: 'diagram', kind: 'synthetic' });
	const lb = parsed.features.find(
		(f: { properties: { bus?: string } }) => f.properties.bus === 'lb'
	);

	// A fresh tab loads the case with the layout as its drawing, through the existing reader.
	const fresh = await context.newPage();
	await fresh.route('**/api/cases', (route) => route.fulfill({ json: [] }));
	await fresh.goto('/');
	// The prerendered input exists before hydration attaches its listener; a file set earlier is
	// lost. The empty-cases panel renders only after load.
	await expect(fresh.getByText('no default cases loaded')).toBeVisible();
	await fresh.locator('input[type=file]').setInputFiles([
		{
			name: 'four-wire-limits.bmopf.json',
			mimeType: 'application/json',
			buffer: await readFile(fixture)
		},
		{
			name: 'four-wire-limits.schematic.geo.json',
			mimeType: 'application/json',
			buffer: Buffer.from(layer)
		}
	]);
	await expect(
		fresh.getByRole('application', { name: 'Network diagram', exact: true })
	).toBeVisible({
		timeout: 60_000
	});
	const circles = fresh.locator('[data-bus-id] circle');
	await expect(circles.first()).toBeVisible();
	const cx = await circles.evaluateAll((els) => els.map((el) => Number(el.getAttribute('cx'))));
	expect(cx).toContain(lb.geometry.coordinates[0]);
});

test('a selected line shows every conductor in the multi-wire view', async ({ page }) => {
	const overview = await solvedOverview(page);
	await overview.getByRole('combobox', { name: 'Find a bus or branch' }).fill('l1');
	await page.keyboard.press('Enter');
	await expect(overview.getByRole('heading', { name: 'Multi-wire view' })).toBeVisible();
	await expect(
		overview.getByRole('img', { name: /line l1: 4 conductor segments between src and lb/ })
	).toBeVisible();
});

test('a flat voltage profile and a case without limits do not break the overview', async ({
	page
}) => {
	// Regression: the shipped example declares no bus voltage limits and its source bus is balanced, so the
	// profile's axis ticks were equal and a value-keyed list threw `each_key_duplicate` (a 500 page).
	await page.route('**/api/cases', (route) => route.fulfill({ json: [] }));
	await page.goto('/');
	// The prerendered input exists before hydration attaches its listener; a file set earlier is
	// lost. The empty-cases panel renders only after load.
	await expect(page.getByText('no default cases loaded')).toBeVisible();
	await page.locator('input[type=file]').setInputFiles({
		name: 'four-wire.bmopf.json',
		mimeType: 'application/json',
		buffer: await readFile(new URL('../static/examples/four-wire.bmopf.json', import.meta.url))
	});
	const solve = page.getByRole('button', { name: 'Solve AC power flow', exact: true });
	await expect(solve).toBeEnabled({ timeout: 60_000 });
	await solve.click();
	const overview = page.getByRole('region', { name: 'Operating point overview' });
	await expect(overview.getByRole('heading', { name: /^Issues/ })).toBeVisible({ timeout: 60_000 });
	for (const id of ['src', 'lb', 'l1']) {
		await overview.getByRole('combobox', { name: 'Find a bus or branch' }).fill(id);
		await page.keyboard.press('Enter');
		await expect(overview.getByRole('heading', { name: 'Voltage profile' })).toBeVisible();
	}
	await overview.getByRole('button', { name: 'Show schematic' }).click();
	await expect(page.getByRole('application', { name: 'Schematic diagram' })).toBeVisible();
	await expect(page.getByText('Internal Error')).toHaveCount(0);
});
