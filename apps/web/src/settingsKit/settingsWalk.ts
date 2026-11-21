import { TABBABLE_SELECTOR } from "@thinkrail/ui/focus";
import type { WalkAction, WalkPlace } from "./settingsKeys";
import { SETTING_ATTR, SETTING_SELECTOR } from "./settingsMarkup";

export interface WalkRect {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
}

export interface WalkElement<E> {
	readonly tagName: string;
	readonly parentElement: E | null;
	closest(selector: string): E | null;
	matches(selector: string): boolean;
	querySelectorAll(selector: string): Iterable<E>;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	contains(other: E | null): boolean;
	compareDocumentPosition(other: E): number;
	focus(options?: { preventScroll?: boolean }): void;
	click(): void;
	checkVisibility?(): boolean;
	getBoundingClientRect?(): WalkRect;
	select?(): void;
	readonly selectionStart?: number | null;
	readonly selectionEnd?: number | null;
	readonly value?: string;
}

const FOLLOWING = 4;
const FOCUSABLE = `${TABBABLE_SELECTOR},[tabindex]:not(:disabled)`;
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "number", "password", "tel"]);

export type TextEntryKind = "single" | "multi";

export function caretAtEnd<E extends WalkElement<E>>(element: E): boolean {
	const length = element.value?.length ?? 0;
	return element.selectionStart === length && element.selectionEnd === length;
}

export function textEntryKind<E extends WalkElement<E>>(element: E): TextEntryKind | null {
	if (element.tagName === "TEXTAREA") return "multi";
	if (element.getAttribute("contenteditable") === "true") return "multi";
	if (element.tagName !== "INPUT") return null;
	return TEXT_INPUT_TYPES.has(element.getAttribute("type") ?? "text") ? "single" : null;
}

const shown = <E extends WalkElement<E>>(element: E) => element.checkVisibility?.() ?? true;

const focusable = <E extends WalkElement<E>>(element: E) =>
	shown(element) && element.matches(FOCUSABLE) && !element.matches(":disabled");

const within = <E extends WalkElement<E>>(scope: E, selector: string): E[] =>
	Array.from(scope.querySelectorAll(selector));

export function topRow<E extends WalkElement<E>>(element: E | null): E | null {
	let row = element?.closest(SETTING_SELECTOR.row) ?? null;
	for (let outer = row?.parentElement?.closest(SETTING_SELECTOR.row) ?? null; outer; ) {
		row = outer;
		outer = outer.parentElement?.closest(SETTING_SELECTOR.row) ?? null;
	}
	return row;
}

export function rowIdOf<E extends WalkElement<E>>(element: E | null): string | null {
	return topRow(element)?.getAttribute(SETTING_ATTR.row) ?? null;
}

function unitOf<E extends WalkElement<E>>(element: E): E | null {
	return element.closest(SETTING_SELECTOR.unit);
}

function treeItems<E extends WalkElement<E>>(row: E): E[] {
	const tree = row.matches(SETTING_SELECTOR.tree)
		? row
		: within(row, SETTING_SELECTOR.tree).find(shown);
	if (!tree) return [];
	return within(tree, SETTING_SELECTOR.treeItem).filter(
		(item) => item.closest(SETTING_SELECTOR.tree) === tree && shown(item),
	);
}

const roving = <E extends WalkElement<E>>(element: E) => element.getAttribute("tabindex") === "-1";

function pick<E extends WalkElement<E>>(candidates: readonly E[]): E | undefined {
	return (
		candidates.find((element) => focusable(element) && !roving(element)) ??
		candidates.find(focusable)
	);
}

export type StopEdge = "first" | "last" | "current";

function treeEntry<E extends WalkElement<E>>(items: readonly E[], edge: StopEdge): E | null {
	if (edge === "current") return pick(items) ?? null;
	return (edge === "first" ? items[0] : items.at(-1)) ?? null;
}

export function stopOf<E extends WalkElement<E>>(row: E, edge: StopEdge = "first"): E | null {
	const items = treeItems(row);
	if (items.length > 0) return treeEntry(items, edge);
	if (focusable(row)) return row;
	return pick(within(row, FOCUSABLE).filter((element) => unitOf(element) === row)) ?? null;
}

export function rowsOf<E extends WalkElement<E>>(root: E): E[] {
	return within(root, SETTING_SELECTOR.row).filter(
		(row) => topRow(row) === row && shown(row) && stopOf(row) !== null,
	);
}

function unitStop<E extends WalkElement<E>>(unit: E): E | null {
	return unit.matches(SETTING_SELECTOR.treeItem) ? unit : stopOf(unit);
}

function partsOf<E extends WalkElement<E>>(unit: E): E[] {
	return within(unit, FOCUSABLE).filter(
		(element) =>
			unitOf(element) === unit && focusable(element) && !element.matches(SETTING_SELECTOR.skipped),
	);
}

function controlOf<E extends WalkElement<E>>(element: E, unit: E): E | null {
	const listbox = element.closest(SETTING_SELECTOR.listbox);
	if (listbox && unit.contains(listbox) && unitOf(listbox) === unit) return listbox;
	if (textEntryKind(element) !== null || element.matches(SETTING_SELECTOR.range)) return element;
	return element.tagName === "SELECT" ? element : null;
}

export interface RowParts<E> {
	readonly unit: E;
	readonly stop: E | null;
	readonly controls: readonly E[];
	readonly toggle: E | null;
	readonly primary: E | null;
	readonly buttons: readonly E[];
}

function rectOf<E extends WalkElement<E>>(element: E): WalkRect | null {
	const rect = element.getBoundingClientRect?.() ?? null;
	return rect && rect.bottom > rect.top ? rect : null;
}

export function visualOrder<E extends WalkElement<E>>(a: E, b: E): number {
	const first = rectOf(a);
	const second = rectOf(b);
	if (!first || !second) return 0;
	if (first.bottom <= second.top) return -1;
	if (second.bottom <= first.top) return 1;
	return first.left - second.left;
}

export function partsOfUnit<E extends WalkElement<E>>(unit: E): RowParts<E> {
	const stop = unitStop(unit);
	const parts = partsOf(unit).filter((element) => element !== stop);
	const controls: E[] = [];
	for (const part of parts) {
		const control = controlOf(part, unit);
		if (control && !controls.includes(control)) controls.push(control);
	}
	const free = parts.filter((part) => controlOf(part, unit) === null);
	const toggle = free.find((part) => part.matches(SETTING_SELECTOR.toggle)) ?? null;
	const primary = unit.matches(SETTING_SELECTOR.primary)
		? unit
		: (free.find((part) => part.matches(SETTING_SELECTOR.primary)) ?? null);
	const buttons = free
		.filter((part) => part !== toggle && part !== primary)
		.sort((a, b) => visualOrder(a, b));
	return { unit, stop, controls, toggle, primary, buttons };
}

export function placeOf<E extends WalkElement<E>>(root: E, target: E): WalkPlace {
	const unit = unitOf(target);
	if (!unit || !root.contains(unit)) return "outside";
	if (target === unitStop(unit)) return "row";
	return controlOf(target, unit) ? "control" : "button";
}

export function isNativeActivator<E extends WalkElement<E>>(element: E): boolean {
	return element.matches(SETTING_SELECTOR.native);
}

export function resetOf<E extends WalkElement<E>>(unit: E): E | null {
	return partsOf(unit).find((part) => part.matches(SETTING_SELECTOR.reset)) ?? null;
}

function land<E extends WalkElement<E>>(element: E | null | undefined): boolean {
	if (!element) return false;
	element.focus();
	return true;
}

export function focusUnitStop<E extends WalkElement<E>>(element: E): boolean {
	const unit = unitOf(element);
	return land(unit ? unitStop(unit) : null);
}

export function enterControl<E extends WalkElement<E>>(control: E): boolean {
	const entry = control.matches(SETTING_SELECTOR.listbox)
		? pick(within(control, FOCUSABLE))
		: focusable(control)
			? control
			: undefined;
	if (!land(entry)) return false;
	if (entry && textEntryKind(entry) !== null) entry.select?.();
	return true;
}

function activate<E extends WalkElement<E>>(unit: E, space: boolean): boolean {
	const { controls, toggle, primary, buttons } = partsOfUnit(unit);
	if (space && toggle) {
		toggle.click();
		return true;
	}
	const [control] = controls;
	if (control) {
		enterControl(control);
		return true;
	}
	const press = primary ?? toggle;
	if (press) {
		press.click();
		return true;
	}
	const actions = buttons.filter((button) => !button.matches(SETTING_SELECTOR.reset));
	const [only] = actions;
	if (only && actions.length === 1) only.click();
	else land(buttons[0]);
	return true;
}

const expandedAs = <E extends WalkElement<E>>(element: E, value: "true" | "false") =>
	element.matches(SETTING_SELECTOR.row) && element.getAttribute("aria-expanded") === value;

function itemsAround<E extends WalkElement<E>>(target: E): { unit: E; items: E[] } | null {
	const unit = unitOf(target);
	if (!unit || unit === target || !unit.matches(SETTING_SELECTOR.treeItem)) return null;
	const tree = unit.closest(SETTING_SELECTOR.tree);
	return { unit, items: tree ? treeItems(tree) : [] };
}

function neighbourItem<E extends WalkElement<E>>(target: E, delta: 1 | -1): E | null {
	const around = itemsAround(target);
	const index = around ? around.items.indexOf(around.unit) : -1;
	return index < 0 ? null : (around?.items[index + delta] ?? null);
}

function neighbourRow<E extends WalkElement<E>>(root: E, target: E, delta: 1 | -1): E | null {
	const rows = rowsOf(root);
	const current = topRow(target);
	const index = current ? rows.indexOf(current) : -1;
	if (index >= 0) return rows[index + delta] ?? null;
	const follows = (row: E) => (target.compareDocumentPosition(row) & FOLLOWING) !== 0;
	return (delta === 1 ? rows.find(follows) : rows.findLast((row) => !follows(row))) ?? null;
}

function stepRow<E extends WalkElement<E>>(root: E, target: E, delta: 1 | -1): boolean {
	if (!root.contains(target) || rowsOf(root).length === 0) return false;
	if (land(neighbourItem(target, delta))) return true;
	const next = neighbourRow(root, target, delta);
	if (next) land(stopOf(next, delta === 1 ? "first" : "last"));
	return true;
}

export function focusSettingRow<E extends WalkElement<E>>(root: E, rowId: string | null): boolean {
	const rows = rowsOf(root);
	const row = rows.find((candidate) => candidate.getAttribute(SETTING_ATTR.row) === rowId);
	const target = row ?? rows[0];
	return target ? land(stopOf(target, "current")) : false;
}

export interface WalkExits {
	readonly toNav: () => void;
	readonly toResults?: (() => void) | undefined;
}

export function performWalk<E extends WalkElement<E>>(
	root: E,
	target: E,
	action: WalkAction,
	exits: WalkExits,
): boolean {
	const unit = unitOf(target);
	switch (action.kind) {
		case "row":
			return stepRow(root, target, action.delta);
		case "edge": {
			const items = itemsAround(target)?.items;
			if (land(action.edge === "first" ? items?.[0] : items?.at(-1))) return true;
			const rows = rowsOf(root);
			const row = action.edge === "first" ? rows[0] : rows.at(-1);
			return row ? land(stopOf(row, action.edge)) : false;
		}
		case "forward": {
			if (!unit) return false;
			if (expandedAs(target, "false")) {
				target.click();
				return true;
			}
			if (expandedAs(target, "true")) return stepRow(root, target, 1);
			const { buttons, controls } = partsOfUnit(unit);
			const [control] = controls;
			if (!land(buttons[0]) && control) enterControl(control);
			return true;
		}
		case "button": {
			if (!unit) return false;
			const { buttons } = partsOfUnit(unit);
			const index = buttons.indexOf(target);
			if (action.delta === 1) land(buttons[index + 1]);
			else land(index > 0 ? buttons[index - 1] : unitStop(unit));
			return true;
		}
		case "activate":
			return unit ? activate(unit, action.space) : false;
		case "along": {
			if (!unit) return false;
			const { controls } = partsOfUnit(unit);
			const index = controls.findIndex((control) => control === target || control.contains(target));
			const next = controls[index + action.delta];
			if (next) enterControl(next);
			else if (action.delta === -1) land(unitStop(unit));
			return true;
		}
		case "exit":
			return unit ? land(unitStop(unit)) : false;
		case "nav":
			if (expandedAs(target, "true")) target.click();
			else exits.toNav();
			return true;
		case "reset": {
			const reset = unit ? resetOf(unit) : null;
			if (!unit || !reset) return false;
			if (target !== unitStop(unit)) land(unitStop(unit));
			reset.click();
			return true;
		}
		case "escape":
			(exits.toResults ?? exits.toNav)();
			return true;
	}
}
