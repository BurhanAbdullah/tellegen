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

test.fixme('7. switch between the map and the schematic, keeping the selection', async () => {
	// Needs the schematic canvas (M3, follow-up PR).
});
test.fixme('8. share a link that reopens the same selection', async () => {
	// Needs the selection in the URL (follow-up PR).
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
