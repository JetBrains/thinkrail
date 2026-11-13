import { TABBABLE_SELECTOR } from "@thinkrail/ui/focus";
import { hasLayer, MODAL_LAYER_SELECTOR } from "../lib";
import type { LayoutToolId } from "./layout";

export type RegionKind = "topbar" | "home" | "left" | "center" | "right" | "bottom";

const RING_RANK: Record<RegionKind, number> = {
	topbar: 0,
	home: 1,
	left: 2,
	center: 3,
	right: 4,
	bottom: 5,
};

interface RegionBox {
	readonly kind: RegionKind;
	readonly rect: { readonly top: number; readonly left: number };
}

export function orderRegions<T extends RegionBox>(regions: readonly T[]): T[] {
	return [...regions].sort(
		(a, b) =>
			RING_RANK[a.kind] - RING_RANK[b.kind] ||
			(a.kind === "center"
				? 0
				: a.kind === "bottom"
					? a.rect.left - b.rect.left
					: a.rect.top - b.rect.top),
	);
}

export const REGION_SELECTOR = "[data-region]";
const ACTIVE_ATTRIBUTE = "data-region-active";
const TRACKING_ATTRIBUTE = "data-region-tracking";
const FOCUS_DEFAULT_SELECTOR = "[data-focus-default]";
const SELECTED_TAB_SELECTOR = '[role="tab"][aria-selected="true"]';
const TERMINAL_SELECTOR = "[data-region] [data-tab-key]";
const FRAME_BUDGET = 120;
const BUSY_FRAME_BUDGET = 90;
const BUSY_SELECTOR = '[aria-busy="true"]';

let activeRegion: HTMLElement | null = null;
let previousRegion: HTMLElement | null = null;
let regionObserver: ResizeObserver | null = null;
const lastFocused = new WeakMap<HTMLElement, HTMLElement>();
let readyTicket = 0;

function isRegionKind(value: string | undefined): value is RegionKind {
	return value !== undefined && Object.hasOwn(RING_RANK, value);
}

function isShown(element: HTMLElement): boolean {
	if (!element.isConnected || element.closest("[inert]") !== null) return false;
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

export function canFocus(element: HTMLElement): boolean {
	return (
		element.isConnected &&
		element.getClientRects().length > 0 &&
		element.closest("[inert]") === null &&
		!element.matches(":disabled") &&
		(element.matches(TABBABLE_SELECTOR) || element.hasAttribute("tabindex"))
	);
}

export function focusTarget(element: HTMLElement): HTMLElement | null {
	if (canFocus(element)) return element;
	for (const candidate of element.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
		if (canFocus(candidate)) return candidate;
	}
	return null;
}

function rememberedIn(container: HTMLElement): HTMLElement | null {
	const region = container.closest<HTMLElement>(REGION_SELECTOR);
	const remembered = region ? lastFocused.get(region) : undefined;
	return remembered && container.contains(remembered) && canFocus(remembered) ? remembered : null;
}

function defaultTarget(container: HTMLElement): HTMLElement | null {
	const defaults = Array.from(container.querySelectorAll<HTMLElement>(FOCUS_DEFAULT_SELECTOR));
	const innermostFirst = [
		...defaults.filter((element) => element.querySelector(FOCUS_DEFAULT_SELECTOR) === null),
		...defaults.filter((element) => element.querySelector(FOCUS_DEFAULT_SELECTOR) !== null),
	];
	for (const preferred of innermostFirst) {
		const target = focusTarget(preferred);
		if (target) return target;
	}
	return null;
}

function landingTarget(region: HTMLElement): HTMLElement | null {
	const remembered = rememberedIn(region);
	if (remembered) return remembered;
	const preferred = defaultTarget(region);
	if (preferred) return preferred;
	const tab = region.querySelector<HTMLElement>(SELECTED_TAB_SELECTOR);
	if (tab && canFocus(tab)) return tab;
	return focusTarget(region);
}

const WORKBENCH_REGION_KINDS: ReadonlySet<string> = new Set<RegionKind>([
	"left",
	"center",
	"right",
	"bottom",
]);

export function activeWorkbenchGroupId(): string | undefined {
	if (!activeRegion || !isShown(activeRegion)) return undefined;
	const { region, regionKind } = activeRegion.dataset;
	return regionKind !== undefined && WORKBENCH_REGION_KINDS.has(regionKind) ? region : undefined;
}

export function regionLandingTarget(lastRegion: HTMLElement | null): HTMLElement | null {
	const region =
		activeRegion && isShown(activeRegion)
			? activeRegion
			: lastRegion && isShown(lastRegion)
				? lastRegion
				: null;
	return region ? landingTarget(region) : null;
}

function focusInsideTarget(container: HTMLElement): HTMLElement | null {
	return rememberedIn(container) ?? defaultTarget(container) ?? focusTarget(container);
}

function setActiveRegion(region: HTMLElement | null): void {
	if (region === activeRegion) return;
	if (activeRegion) {
		activeRegion.removeAttribute(ACTIVE_ATTRIBUTE);
		regionObserver?.unobserve(activeRegion);
		previousRegion = activeRegion;
	}
	activeRegion = region;
	const root = document.documentElement;
	if (!region) {
		root.removeAttribute(TRACKING_ATTRIBUTE);
		return;
	}
	region.setAttribute(ACTIVE_ATTRIBUTE, "");
	root.setAttribute(TRACKING_ATTRIBUTE, "");
	regionObserver?.observe(region);
}

export function installRegionTracker(): () => void {
	regionObserver = new ResizeObserver(() => {
		if (activeRegion && !isShown(activeRegion)) setActiveRegion(null);
	});
	const onFocusIn = (event: FocusEvent) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const region = target.closest<HTMLElement>(REGION_SELECTOR);
		if (!region) return;
		if (target !== region) lastFocused.set(region, target);
		setActiveRegion(region);
	};
	document.addEventListener("focusin", onFocusIn);
	return () => {
		document.removeEventListener("focusin", onFocusIn);
		setActiveRegion(null);
		previousRegion = null;
		regionObserver?.disconnect();
		regionObserver = null;
	};
}

export function whenSettled<T>(probe: () => T | null, run: (value: T) => void): void {
	readyTicket += 1;
	const ticket = readyTicket;
	let frames = FRAME_BUDGET;
	const attempt = () => {
		if (ticket !== readyTicket) return;
		const value = hasLayer(document, MODAL_LAYER_SELECTOR) ? null : probe();
		if (value !== null) run(value);
		else if (frames-- > 0) requestAnimationFrame(attempt);
	};
	attempt();
}

export function focusWhenSettled(resolve: () => HTMLElement | null): void {
	whenSettled(resolve, (target) => target.focus());
}

function shownRegions(): HTMLElement[] {
	const boxes: Array<RegionBox & { element: HTMLElement }> = [];
	for (const element of document.querySelectorAll<HTMLElement>(REGION_SELECTOR)) {
		const kind = element.dataset.regionKind;
		if (!isRegionKind(kind) || !isShown(element)) continue;
		boxes.push({ element, kind, rect: element.getBoundingClientRect() });
	}
	return orderRegions(boxes).map(({ element }) => element);
}

function regionLanding(pick: (regions: HTMLElement[]) => HTMLElement | undefined) {
	return () => {
		const region = pick(shownRegions());
		return region ? landingTarget(region) : null;
	};
}

export function focusAdjacentRegion(delta: 1 | -1): void {
	focusWhenSettled(
		regionLanding((regions) => {
			const index = activeRegion ? regions.indexOf(activeRegion) : -1;
			if (index < 0) return delta === 1 ? regions[0] : regions.at(-1);
			return regions[(index + delta + regions.length) % regions.length];
		}),
	);
}

export function focusCenterRegion(index: number): void {
	focusWhenSettled(
		regionLanding(
			(regions) => regions.filter((region) => region.dataset.regionKind === "center")[index],
		),
	);
}

export function focusRegionOfKind(kind: RegionKind): void {
	focusWhenSettled(
		regionLanding((regions) => regions.find((region) => region.dataset.regionKind === kind)),
	);
}

export function focusToolBody(
	tool: LayoutToolId,
	ready: (body: HTMLElement) => boolean = () => true,
): void {
	let patience = BUSY_FRAME_BUDGET;
	focusWhenSettled(() => {
		const body = document.querySelector<HTMLElement>(
			`${REGION_SELECTOR} [data-tool-body="${tool}"]`,
		);
		if (!body || !isShown(body) || !ready(body)) return null;
		if (body.querySelector(BUSY_SELECTOR) && patience-- > 0) return null;
		return focusInsideTarget(body);
	});
}

export function terminalTarget(tabKey: string | null): HTMLElement | null {
	const terminals = Array.from(document.querySelectorAll<HTMLElement>(TERMINAL_SELECTOR)).filter(
		isShown,
	);
	const terminal =
		terminals.find((candidate) => candidate.dataset.tabKey === tabKey) ?? terminals[0];
	const host = terminal?.querySelector<HTMLElement>(FOCUS_DEFAULT_SELECTOR);
	return host ? focusInsideTarget(host) : null;
}

export function focusPreviousRegion(): boolean {
	const region = previousRegion;
	if (!region || !isShown(region) || region.contains(document.activeElement)) return false;
	focusWhenSettled(() => landingTarget(region));
	return true;
}
