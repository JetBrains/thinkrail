import { TABBABLE_SELECTOR } from "@thinkrail/ui/focus";
import type { WalkAction } from "./settingsKeys";
import { SETTING_ATTR, SETTING_SELECTOR } from "./settingsMarkup";

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
}

const FOLLOWING = 4;
const FOCUSABLE = `${TABBABLE_SELECTOR},[tabindex]:not(:disabled)`;
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "number", "password", "tel"]);

export type TextEntryKind = "single" | "multi";

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

export function unitOf<E extends WalkElement<E>>(element: E): E | null {
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
	if (row.matches(SETTING_SELECTOR.stop) && focusable(row)) return row;
	return (
		pick(within(row, SETTING_SELECTOR.stop)) ??
		pick(within(row, SETTING_SELECTOR.control).flatMap((slot) => within(slot, FOCUSABLE))) ??
		pick(
			within(row, FOCUSABLE).filter((element) => element.closest(SETTING_SELECTOR.side) === null),
		) ??
		(focusable(row) ? row : null)
	);
}

export function rowsOf<E extends WalkElement<E>>(root: E): E[] {
	return within(root, SETTING_SELECTOR.row).filter(
		(row) => topRow(row) === row && shown(row) && stopOf(row) !== null,
	);
}

export function sidesOf<E extends WalkElement<E>>(unit: E): E[] {
	return within(unit, SETTING_SELECTOR.side).filter(
		(side) => unitOf(side) === unit && focusable(side),
	);
}

export function sideOf<E extends WalkElement<E>>(element: E): E | null {
	const side = element.closest(SETTING_SELECTOR.side);
	const unit = side ? unitOf(side) : null;
	return side && unit && sidesOf(unit).includes(side) ? side : null;
}

export function resetOf<E extends WalkElement<E>>(unit: E): E | null {
	return sidesOf(unit).find((side) => side.matches(SETTING_SELECTOR.reset)) ?? null;
}

function unitStop<E extends WalkElement<E>>(unit: E): E | null {
	return unit.matches(SETTING_SELECTOR.treeItem) ? unit : stopOf(unit);
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

function neighbourItem<E extends WalkElement<E>>(target: E, delta: 1 | -1): E | null {
	const unit = unitOf(target);
	if (!unit || unit === target || !unit.matches(SETTING_SELECTOR.treeItem)) return null;
	const tree = unit.closest(SETTING_SELECTOR.tree);
	const items = tree ? treeItems(tree) : [];
	const index = items.indexOf(unit);
	return index < 0 ? null : (items[index + delta] ?? null);
}

function neighbourRow<E extends WalkElement<E>>(root: E, target: E, delta: 1 | -1): E | null {
	const rows = rowsOf(root);
	const current = topRow(target);
	const index = current ? rows.indexOf(current) : -1;
	if (index >= 0) return rows[index + delta] ?? null;
	const follows = (row: E) => (target.compareDocumentPosition(row) & FOLLOWING) !== 0;
	return (delta === 1 ? rows.find(follows) : rows.findLast((row) => !follows(row))) ?? null;
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
	switch (action.kind) {
		case "row": {
			if (!root.contains(target) || rowsOf(root).length === 0) return false;
			if (land(neighbourItem(target, action.delta))) return true;
			const next = neighbourRow(root, target, action.delta);
			if (next) land(stopOf(next, action.delta === 1 ? "first" : "last"));
			return true;
		}
		case "edge": {
			const rows = rowsOf(root);
			const row = action.edge === "first" ? rows[0] : rows.at(-1);
			return row ? land(stopOf(row, action.edge)) : false;
		}
		case "side": {
			const unit = unitOf(target);
			if (!unit) return false;
			const sides = sidesOf(unit);
			const side = sideOf(target);
			if (action.delta === 1)
				return land(side ? sides[sides.indexOf(side) + 1] : sides[0]) || !!side;
			if (!side) return false;
			return land(sides[sides.indexOf(side) - 1] ?? unitStop(unit));
		}
		case "nav":
			exits.toNav();
			return true;
		case "reset": {
			const unit = unitOf(target);
			const reset = unit ? resetOf(unit) : null;
			if (!unit || !reset) return false;
			if (sideOf(target)) focusUnitStop(target);
			reset.click();
			return true;
		}
		case "escape":
			(exits.toResults ?? exits.toNav)();
			return true;
	}
}
