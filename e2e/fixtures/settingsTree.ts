import type { Page } from "@playwright/test";
import { openSettingsSection } from "./app";

const UNIT = '[data-setting-row], [role="treeitem"]';

const CONTROL =
	'[role="listbox"], textarea, select, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="number"], input[type="password"], input[type="tel"], input[type="range"]';

interface Focus {
	readonly tab: string | null;
	readonly nav: boolean;
	readonly row: boolean;
	readonly editing: boolean;
	readonly unit: string | null;
	readonly expandable: boolean;
	readonly controls: number;
	readonly text: boolean;
	readonly leavesOnRight: boolean;
}

const focusNow = (page: Page) =>
	page.evaluate(
		({ unitSelector, controlSelector }): Focus => {
			const active = document.activeElement;
			if (!(active instanceof HTMLElement)) {
				return {
					tab: null,
					nav: false,
					row: false,
					editing: false,
					unit: null,
					expandable: false,
					controls: 0,
					text: false,
					leavesOnRight: false,
				};
			}
			if (!active.dataset.e2eTab && active.closest("[data-settings-content]")) {
				active.dataset.e2eTab = `late-${document.querySelectorAll("[data-e2e-tab]").length}`;
			}
			const unit = active.closest<HTMLElement>(unitSelector);
			const owned = (selector: string) =>
				unit
					? Array.from(unit.querySelectorAll<HTMLElement>(selector)).filter(
							(element) => element.closest(unitSelector) === unit,
						)
					: [];
			const container = unit !== null && !unit.hasAttribute("tabindex");
			const stop = container ? owned("button, a[href], input, [tabindex]")[0] : unit;
			const listbox = active.closest('[role="listbox"]');
			const options = Array.from(
				listbox?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
			);
			const range = active instanceof HTMLInputElement && active.type === "range";
			const leavesOnRight = listbox
				? listbox.getAttribute("aria-orientation") === "vertical" || options.at(-1) === active
				: range
					? Number(active.value) >= Number(active.max || 100)
					: active.matches(controlSelector) && active.tagName !== "TEXTAREA";
			return {
				tab: active.dataset.e2eTab ?? null,
				nav: active.getAttribute("role") === "tab" || !active.closest("[data-settings-dialog]"),
				row: unit !== null && active === stop,
				editing: listbox !== null || active.matches(controlSelector),
				unit: unit?.dataset.e2eTab ?? null,
				expandable:
					active.getAttribute("role") === "treeitem" && active.hasAttribute("aria-expanded"),
				controls: owned(controlSelector).filter((control) => control.checkVisibility()).length,
				text: active.matches(controlSelector) && !range && active.tagName !== "SELECT",
				leavesOnRight,
			};
		},
		{ unitSelector: UNIT, controlSelector: CONTROL },
	);

const press = async (page: Page, key: string) => {
	await page.keyboard.press(key);
	return focusNow(page);
};

async function tagContent(page: Page): Promise<void> {
	await page.evaluate(() => {
		const content = document.querySelector("[data-settings-content]");
		let index = 0;
		for (const element of content?.querySelectorAll<HTMLElement>("*") ?? []) {
			element.dataset.e2eTab = `t${index++}`;
		}
	});
}

async function unreached(page: Page, visited: ReadonlySet<string>): Promise<string[]> {
	return page.evaluate(
		({ seen, unitSelector }) => {
			const content = document.querySelector("[data-settings-content]");
			const tabbable =
				'button, a[href], input, select, textarea, [contenteditable="true"], [tabindex]';
			const operated =
				'[role="switch"], [data-setting-toggle], [data-setting-primary], [data-focus-row-primary], [data-setting-reset]';
			const name = (element: HTMLElement) =>
				element.dataset.testid ??
				element.getAttribute("aria-label") ??
				element.textContent?.trim().slice(0, 40) ??
				element.tagName;
			const missing: string[] = [];
			for (const element of content?.querySelectorAll<HTMLElement>(tabbable) ?? []) {
				const unit = element.closest<HTMLElement>(unitSelector);
				const rovesWithItem =
					unit?.getAttribute("role") === "treeitem" &&
					unit.tabIndex < 0 &&
					!element.matches('[role="option"]');
				if ((element.tabIndex < 0 && !rovesWithItem) || element.matches(":disabled")) continue;
				if (!element.checkVisibility() || element.closest('[aria-hidden="true"]')) continue;
				if (seen.includes(element.dataset.e2eTab ?? "")) continue;
				const fromRow =
					unit !== null && seen.includes(unit.dataset.e2eTab ?? "") && element.matches(operated);
				if (!fromRow) missing.push(`${unit ? "" : "(no row) "}${name(element)}`);
			}
			return missing;
		},
		{ seen: [...visited], unitSelector: UNIT },
	);
}

async function backToRow(page: Page): Promise<Focus> {
	for (let step = 0; step < 4; step += 1) {
		const now = await focusNow(page);
		if (now.row || now.nav) return now;
		await page.keyboard.press("Escape");
	}
	return focusNow(page);
}

async function alongControls(page: Page, from: Focus, visited: Set<string>): Promise<void> {
	let now = from;
	for (let step = 0; step < 8 && now.editing && now.leavesOnRight; step += 1) {
		if (now.text) await page.keyboard.press("End");
		const next = await press(page, "ArrowRight");
		if (next.tab) visited.add(next.tab);
		if (next.tab === now.tab || next.unit !== from.unit) return;
		now = next;
	}
}

export async function unreachedInSection(page: Page, section: string): Promise<string[]> {
	await openSettingsSection(page, section);
	await page.waitForTimeout(800);
	await tagContent(page);
	await page.getByTestId(`settings-nav-${section}`).focus();
	let now = await press(page, "ArrowRight");
	if (now.nav) return unreached(page, new Set());
	for (let guard = 0; guard < 200; guard += 1) {
		const above = await press(page, "ArrowUp");
		if (above.tab === now.tab) break;
		now = above;
	}
	const visited = new Set<string>();
	for (let guard = 0; guard < 400; guard += 1) {
		if (now.tab) visited.add(now.tab);
		const unit = now.unit;
		if (!now.expandable) {
			let previous = now.tab;
			for (let step = 0; step < 12; step += 1) {
				const next = await press(page, "ArrowRight");
				if (next.tab) visited.add(next.tab);
				if (next.tab === previous || next.unit !== unit || next.editing) break;
				previous = next.tab;
			}
			const back = await backToRow(page);
			if (back.unit !== unit) {
				now = back;
				continue;
			}
			if (now.controls > 0) {
				const entered = await press(page, "Enter");
				if (entered.tab) visited.add(entered.tab);
				if (now.controls > 1) await alongControls(page, entered, visited);
				await backToRow(page);
			}
		}
		const before = (await focusNow(page)).tab;
		now = await press(page, "ArrowDown");
		if (now.tab === before) break;
	}
	return unreached(page, visited);
}
