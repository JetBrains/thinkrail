import { TABBABLE_SELECTOR } from "@thinkrail/ui/focus";
import { canFocus, focusTarget, REGION_SELECTOR, regionLandingTarget } from "./regions";

const LIST_ATTRIBUTE = "data-focus-list";
const ROW_ATTRIBUTE = "data-focus-row";
const SLOT_ATTRIBUTE = "data-focus-slot";
const FALLBACK_ATTRIBUTE = "data-focus-fallback";
const LIST_SELECTOR = `[${LIST_ATTRIBUTE}]`;
const ROW_SELECTOR = `[${ROW_ATTRIBUTE}]`;
const PRIMARY_SELECTOR = "[data-focus-row-primary]";
const FOCUS_DEFAULT_SELECTOR = "[data-focus-default]";
const LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]';
const WATCHED_ATTRIBUTES = ["disabled", "hidden", "inert"];
const GRACE_FRAMES = 180;
const MAX_LEVELS = 4;
const MAX_SIBLING_DEPTH = 3;
const MAX_OPENERS = 8;

export const WAIT = Symbol("wait");

export type ActiveFocus = "recorded" | "none" | "layer" | "elsewhere";

export interface FocusLevel {
	readonly listKey: string;
	readonly rowId: string | null;
	readonly nextRowId: string | null;
	readonly previousRowId: string | null;
}

export interface FocusContext {
	readonly levels: readonly FocusLevel[];
	readonly slot: string | null;
	readonly anchored: boolean;
	readonly inLayer: boolean;
}

export interface FocusLookup<T> {
	row(listKey: string, rowId: string): T | null;
	slot(slot: string): T | null;
	fallback(listKey: string): T | null;
	listStart(listKey: string): T | null;
	listDefault(listKey: string): T | null;
	listShown(listKey: string): boolean;
	nearestSibling(): T | null;
	layerStart(): T | null;
	regionLanding(): T | null;
}

export type FocusOutcome = "keep" | "recover" | "restore" | "forget";

export function isFocusLost(active: ActiveFocus, recordedFocusable: boolean): boolean {
	return active !== "elsewhere" && !recordedFocusable;
}

export function focusOutcome(
	active: ActiveFocus,
	recordedFocusable: boolean,
	disrupted: boolean,
): FocusOutcome {
	if (active === "elsewhere") return "keep";
	if (!recordedFocusable) return "recover";
	if (active === "recorded") return "keep";
	return disrupted ? "restore" : "forget";
}

export function nearestControl(before: number, total: number): number | null {
	if (before > 0) return before - 1;
	return before < total ? before : null;
}

export function resolveFocus<T>(
	context: FocusContext,
	lookup: FocusLookup<T>,
	graceOver: boolean,
): T | null | typeof WAIT {
	const [innermost] = context.levels;
	const same =
		(innermost?.rowId ? lookup.row(innermost.listKey, innermost.rowId) : null) ??
		(context.slot ? lookup.slot(context.slot) : null);
	if (same) return same;
	const sibling = context.anchored ? lookup.nearestSibling() : null;
	if (sibling) return sibling;
	for (const [depth, level] of context.levels.entries()) {
		for (const id of [depth > 0 ? level.rowId : null, level.nextRowId, level.previousRowId]) {
			const row = id ? lookup.row(level.listKey, id) : null;
			if (row) return row;
		}
		const fallback = lookup.fallback(level.listKey) ?? lookup.listStart(level.listKey);
		if (fallback) return fallback;
	}
	const outermost = context.levels.at(-1);
	const listDefault = outermost ? lookup.listDefault(outermost.listKey) : null;
	if (listDefault) return listDefault;
	if (innermost && !graceOver && !lookup.listShown(innermost.listKey)) return WAIT;
	return context.inLayer ? lookup.layerStart() : lookup.regionLanding();
}

interface FocusRecord {
	readonly element: HTMLElement;
	levels: readonly FocusLevel[];
	readonly slot: string | null;
	readonly slotOutsideRows: boolean;
	readonly layer: HTMLElement | null;
	readonly region: HTMLElement | null;
	readonly opener: FocusRecord | null;
	readonly depth: number;
	visible: boolean;
	disrupted: boolean;
}

function attributeSelector(name: string, value: string): string {
	return `[${name}="${CSS.escape(value)}"]`;
}

function listKeyOf(row: HTMLElement): string | null {
	return row.parentElement?.closest(LIST_SELECTOR)?.getAttribute(LIST_ATTRIBUTE) ?? null;
}

function layerAlive(layer: HTMLElement): boolean {
	return layer.isConnected && layer.getAttribute("data-state") !== "closed";
}

function stillFocusable(element: HTMLElement): boolean {
	return (
		element.isConnected &&
		!element.matches(":disabled") &&
		element.closest("[inert]") === null &&
		element.getClientRects().length > 0
	);
}

function scopeOf(layer: HTMLElement | null): ParentNode {
	return layer && layerAlive(layer) ? layer : document;
}

function rowsOf(scope: ParentNode, key: string): HTMLElement[] {
	return Array.from(
		scope.querySelectorAll<HTMLElement>(
			`${attributeSelector(LIST_ATTRIBUTE, key)} ${ROW_SELECTOR}`,
		),
	).filter((row) => listKeyOf(row) === key);
}

function levelsOf(element: HTMLElement, scope: ParentNode): FocusLevel[] {
	const levels: FocusLevel[] = [];
	let from = element;
	let list = element.closest<HTMLElement>(LIST_SELECTOR);
	while (list && levels.length < MAX_LEVELS) {
		const key = list.getAttribute(LIST_ATTRIBUTE) ?? "";
		const closest = from.closest<HTMLElement>(ROW_SELECTOR);
		const row = closest && closest !== list && list.contains(closest) ? closest : null;
		const rows = row ? rowsOf(scope, key) : [];
		const index = row ? rows.indexOf(row) : -1;
		levels.push({
			listKey: key,
			rowId: row?.getAttribute(ROW_ATTRIBUTE) ?? null,
			nextRowId: index >= 0 ? (rows[index + 1]?.getAttribute(ROW_ATTRIBUTE) ?? null) : null,
			previousRowId: index > 0 ? (rows[index - 1]?.getAttribute(ROW_ATTRIBUTE) ?? null) : null,
		});
		from = list;
		list = list.parentElement?.closest<HTMLElement>(LIST_SELECTOR) ?? null;
	}
	return levels;
}

function openerFor(previous: FocusRecord | null, layer: HTMLElement | null): FocusRecord | null {
	if (!previous) return null;
	if (previous.layer === layer) return previous.opener;
	for (let record = previous.opener; record; record = record.opener) {
		if (record.layer === layer) return record.opener;
	}
	return layer && previous.depth < MAX_OPENERS ? previous : null;
}

function describe(element: HTMLElement, previous: FocusRecord | null): FocusRecord {
	const layer = element.closest<HTMLElement>(LAYER_SELECTOR);
	const opener = openerFor(previous, layer);
	const inRow = element.closest(ROW_SELECTOR) !== null;
	const slot = element.getAttribute(SLOT_ATTRIBUTE);
	const testId = inRow ? null : element.getAttribute("data-testid");
	return {
		element,
		levels: levelsOf(element, scopeOf(layer)),
		slot: slot
			? attributeSelector(SLOT_ATTRIBUTE, slot)
			: testId
				? attributeSelector("data-testid", testId)
				: null,
		slotOutsideRows: !slot,
		layer,
		region: element.closest<HTMLElement>(REGION_SELECTOR),
		opener,
		depth: opener ? opener.depth + 1 : 0,
		visible: true,
		disrupted: false,
	};
}

function rowTarget(row: HTMLElement): HTMLElement | null {
	for (const primary of row.querySelectorAll<HTMLElement>(PRIMARY_SELECTOR)) {
		if (primary.closest(ROW_SELECTOR) !== row) continue;
		const target = focusTarget(primary);
		if (target) return target;
	}
	if (canFocus(row)) return row;
	for (const control of row.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
		if (control.closest(ROW_SELECTOR) === row && canFocus(control)) return control;
	}
	return null;
}

function inRegionFirst(
	candidates: Iterable<HTMLElement>,
	region: HTMLElement | null,
	pick: (candidate: HTMLElement) => HTMLElement | null,
): HTMLElement | null {
	let elsewhere: HTMLElement | null = null;
	for (const candidate of candidates) {
		const target = pick(candidate);
		if (!target) continue;
		if (!region || region.contains(candidate)) return target;
		elsewhere ??= target;
	}
	return elsewhere;
}

function nearestSibling(element: HTMLElement, boundary: HTMLElement | null): HTMLElement | null {
	let container = element.isConnected ? element.parentElement : null;
	for (let depth = 0; depth < MAX_SIBLING_DEPTH; depth += 1) {
		if (!container || container === boundary || container === document.body) return null;
		const controls = Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
			(control) => control !== element && canFocus(control),
		);
		if (controls.length > 0) {
			const before = controls.filter(
				(control) => control.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
			).length;
			const index = nearestControl(before, controls.length);
			return index === null ? null : (controls[index] ?? null);
		}
		container = container.parentElement;
	}
	return null;
}

function firstTabbable(container: HTMLElement): HTMLElement | null {
	for (const control of container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
		if (canFocus(control)) return control;
	}
	return null;
}

function slotCandidates(
	source: FocusRecord,
	scope: ParentNode,
	region: HTMLElement | null,
): HTMLElement[] {
	if (!source.slot) return [];
	return Array.from(scope.querySelectorAll<HTMLElement>(source.slot)).filter(
		(candidate) =>
			(!region || region.contains(candidate)) &&
			!(source.slotOutsideRows && candidate.closest(ROW_SELECTOR) !== null),
	);
}

function domLookup(
	source: FocusRecord,
	layer: HTMLElement | null,
	anchor: HTMLElement | null,
): FocusLookup<HTMLElement> {
	const scope: ParentNode = layer ?? document;
	const region = source.region?.isConnected ? source.region : null;
	const query = (selector: string) => scope.querySelectorAll<HTMLElement>(selector);
	const lists = (key: string) => query(attributeSelector(LIST_ATTRIBUTE, key));
	return {
		row: (key, id) =>
			inRegionFirst(
				Array.from(query(attributeSelector(ROW_ATTRIBUTE, id))).filter(
					(row) => listKeyOf(row) === key,
				),
				region,
				rowTarget,
			),
		slot: () => slotCandidates(source, scope, region).find(canFocus) ?? null,
		fallback: (key) =>
			inRegionFirst(query(attributeSelector(FALLBACK_ATTRIBUTE, key)), region, focusTarget),
		listStart: (key) => inRegionFirst(lists(key), region, focusTarget),
		listDefault: (key) =>
			inRegionFirst(lists(key), region, (list) => {
				const preferred = list.closest<HTMLElement>(FOCUS_DEFAULT_SELECTOR);
				return preferred ? focusTarget(preferred) : null;
			}),
		listShown: (key) => lists(key).length > 0,
		nearestSibling: () => (anchor ? nearestSibling(anchor, layer ?? region) : null),
		layerStart: () => (layer ? firstTabbable(layer) : null),
		regionLanding: () => (source.region ? regionLandingTarget(source.region) : null),
	};
}

function liveSource(lost: FocusRecord): FocusRecord | null {
	let source: FocusRecord | null = lost;
	while (source?.layer && !layerAlive(source.layer)) source = source.opener;
	return source;
}

function anchorOf(source: FocusRecord): HTMLElement | null {
	if (source.element.isConnected) return source.element;
	const region = source.region?.isConnected ? source.region : null;
	return slotCandidates(source, scopeOf(source.layer), region)[0] ?? null;
}

function recoveryTarget(lost: FocusRecord, graceOver: boolean): HTMLElement | null | typeof WAIT {
	const source = liveSource(lost);
	if (!source) return regionLandingTarget(lost.region);
	if (source !== lost && stillFocusable(source.element) && canFocus(source.element)) {
		return source.element;
	}
	const anchor = anchorOf(source);
	return resolveFocus(
		{
			levels: source.levels,
			slot: source.slot,
			anchored: anchor !== null,
			inLayer: source.layer !== null,
		},
		domLookup(source, source.layer, anchor),
		graceOver,
	);
}

function activeFocus(record: FocusRecord): ActiveFocus {
	const active = document.activeElement;
	if (active === record.element) return "recorded";
	if (!active || active === document.body || active === document.documentElement) return "none";
	for (let current: FocusRecord | null = record; current; current = current.opener) {
		if (current.layer && active === current.layer) return "layer";
	}
	return "elsewhere";
}

interface Comeback {
	readonly record: FocusRecord;
	readonly placed: HTMLElement | null;
}

export function installFocusRecovery(): () => void {
	let record: FocusRecord | null = null;
	let recovering: FocusRecord | null = null;
	let comeback: Comeback | null = null;
	let stale = false;
	let frame = 0;
	let ticket = 0;

	const recover = (lost: FocusRecord) => {
		ticket += 1;
		const current = ticket;
		recovering = lost;
		let frames = GRACE_FRAMES;
		const attempt = () => {
			if (current !== ticket) return;
			if (!isFocusLost(activeFocus(lost), stillFocusable(lost.element))) {
				recovering = null;
				return;
			}
			const target = recoveryTarget(lost, frames <= 0);
			if (target === WAIT) {
				frames -= 1;
				requestAnimationFrame(attempt);
				return;
			}
			recovering = null;
			if (record === lost) record = null;
			comeback =
				liveSource(lost) === lost && anchorOf(lost) ? { record: lost, placed: target } : null;
			target?.focus({ preventScroll: true });
			if (lost.visible) target?.scrollIntoView({ block: "nearest", inline: "nearest" });
		};
		attempt();
	};

	const returnFromRecovery = (pending: Comeback): boolean => {
		const resting = pending.placed
			? document.activeElement === pending.placed
			: activeFocus(pending.record) !== "elsewhere";
		if (!resting) {
			comeback = null;
			return false;
		}
		const back = anchorOf(pending.record);
		if (!back || !stillFocusable(back) || !canFocus(back)) return false;
		comeback = null;
		back.focus({ preventScroll: true });
		return true;
	};

	const check = () => {
		frame = 0;
		if (comeback && returnFromRecovery(comeback)) return;
		const current = record;
		if (!current || recovering === current) return;
		if (stale && current.element.isConnected) {
			current.levels = levelsOf(current.element, scopeOf(current.layer));
		}
		stale = false;
		const focusable = stillFocusable(current.element);
		const outcome = focusOutcome(activeFocus(current), focusable, current.disrupted);
		if (outcome === "recover") recover(current);
		else if (outcome === "restore" && canFocus(current.element)) {
			current.element.focus({ preventScroll: true });
		} else if (outcome !== "keep") record = null;
	};

	const schedule = () => {
		if (frame === 0) frame = requestAnimationFrame(check);
	};

	const visibility = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (record && entry.target === record.element) record.visible = entry.isIntersecting;
		}
	});

	const onFocusIn = (event: FocusEvent) => {
		const target = event.target;
		if (!(target instanceof HTMLElement) || target.matches(LAYER_SELECTOR)) return;
		ticket += 1;
		recovering = null;
		stale = false;
		if (comeback && target !== comeback.placed) comeback = null;
		record = describe(target, record);
		visibility.disconnect();
		visibility.observe(target);
	};

	const forgetPending = () => {
		comeback = null;
		if (record) record.disrupted = false;
	};

	const observer = new MutationObserver((mutations) => {
		if (comeback) schedule();
		const current = record;
		if (!current) return;
		const disrupted = mutations.some(
			(mutation) => mutation.type === "attributes" && mutation.target.contains(current.element),
		);
		if (disrupted) current.disrupted = true;
		const touched = disrupted || !current.element.isConnected;
		if (!touched && current.levels.length === 0) return;
		if (!touched) stale = true;
		schedule();
	});

	document.addEventListener("focusin", onFocusIn);
	document.addEventListener("focusout", schedule);
	document.addEventListener("keydown", forgetPending, true);
	document.addEventListener("pointerdown", forgetPending, true);
	observer.observe(document.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: WATCHED_ATTRIBUTES,
	});
	return () => {
		document.removeEventListener("focusin", onFocusIn);
		document.removeEventListener("focusout", schedule);
		document.removeEventListener("keydown", forgetPending, true);
		document.removeEventListener("pointerdown", forgetPending, true);
		observer.disconnect();
		visibility.disconnect();
		cancelAnimationFrame(frame);
		ticket += 1;
		record = null;
		recovering = null;
		comeback = null;
	};
}
