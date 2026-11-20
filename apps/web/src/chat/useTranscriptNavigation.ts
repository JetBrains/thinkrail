import { focusAndReveal, TABBABLE_SELECTOR } from "@thinkrail/ui/focus";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import {
	type ReadingDirection,
	type ReadingSpan,
	scrollBeforeStep,
	spansOverlap,
	stepRevealDelta,
} from "@thinkrail/ui/reading";
import { useEffect, useInsertionEffect, useState } from "react";
import { LOCAL_KEY_DEFAULTS } from "@/keybindings";
import { copyText, resolveTreeMove } from "@/lib";
import { ACTIVITY_BREADCRUMB_HEIGHT } from "./activityBreadcrumbs";
import { foldOverride } from "./foldState";
import { type ChatRow, rowIdForToolCall } from "./rows";
import type { TranscriptMenu, TranscriptMenuAction, TranscriptNavigation } from "./TranscriptItem";
import {
	keyboardLeavesFollow,
	type TranscriptKeyAction,
	type TranscriptNavItem,
	transcriptItemCopyText,
	transcriptItemFilePath,
	transcriptItems,
	transcriptKeyAction,
} from "./transcriptNavigation";
import type { ChatScroll } from "./useChatScroll";

export interface TranscriptNavigationOptions {
	rows: readonly ChatRow[];
	newestRowId: string | null;
	latestRowId: string | null;
	revealRow: ChatScroll["revealRow"];
	revealElement: ChatScroll["revealElement"];
	leaveFollow: ChatScroll["leaveFollow"];
	scrollBy: ChatScroll["keyboardScrollBy"];
	scrollPage: ChatScroll["scrollPage"];
	scrollToLatest: () => void;
	focusComposer: () => void;
	waitingQuestion: () => HTMLElement | null;
	fileTarget: (path: string) => string | null;
	openFile: (target: string) => void;
	onCopied: () => void;
}

type TranscriptKeys = Pick<LocalKeys, "match">;

export interface TranscriptNavigationController extends TranscriptNavigation {
	configure: (options: TranscriptNavigationOptions, keys: TranscriptKeys) => void;
	attach: (scroller: HTMLElement) => () => void;
	focusNewest: (returned?: boolean) => void;
	focusRow: (rowId: string) => void;
	parkOnToolCall: (toolCallId: string) => void;
}

const ITEM = "[data-transcript-item]";
const FEED = "[data-transcript-feed]";
const TOGGLE = "[data-activity-node-toggle], [data-chat-item-toggle]";
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]';
const MOUNT_WAIT_FRAMES = 120;

function focusable(element: HTMLElement): boolean {
	return (
		element.tabIndex >= 0 &&
		!element.matches(":disabled") &&
		element.closest("[inert]") === null &&
		element.getClientRects().length > 0
	);
}

function follows(from: Node, to: Node): boolean {
	return (from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function tabbableAfter(boundary: HTMLElement, includeInside: boolean): HTMLElement | null {
	for (const element of document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
		if (!follows(boundary, element) || (!includeInside && boundary.contains(element))) continue;
		if (focusable(element)) return element;
	}
	return null;
}

function tabbableBefore(boundary: HTMLElement): HTMLElement | null {
	const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));
	for (let at = all.length - 1; at >= 0; at -= 1) {
		const element = all[at];
		if (!element || !follows(element, boundary) || element.contains(boundary)) continue;
		if (focusable(element)) return element;
	}
	return null;
}

function viewportBounds(scroller: HTMLElement, inset: number): { top: number; bottom: number } {
	const rect = scroller.getBoundingClientRect();
	return { top: rect.top + inset, bottom: rect.bottom };
}

function intersects(element: HTMLElement, scroller: HTMLElement): boolean {
	return spansOverlap(element.getBoundingClientRect(), viewportBounds(scroller, 0));
}

function sticksOut(element: HTMLElement, scroller: HTMLElement, inset: number): boolean {
	const rect = element.getBoundingClientRect();
	const viewport = viewportBounds(scroller, inset);
	return (
		(rect.top < viewport.top - 1 && rect.bottom < viewport.bottom - 1) ||
		(rect.bottom > viewport.bottom + 1 && rect.top > viewport.top + 1)
	);
}

export function createTranscriptNavigation(): TranscriptNavigationController {
	let options: TranscriptNavigationOptions | null = null;
	let keys: TranscriptKeys | null = null;
	let scroller: HTMLElement | null = null;
	let cursor: string | null = null;
	let cursorIndex = 0;
	let menu: TranscriptMenu | null = null;
	let cancelPending: (() => void) | null = null;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};

	const setCursor = (id: string | null, index?: number) => {
		if (index !== undefined && index >= 0) cursorIndex = index;
		if (id === cursor) return;
		cursor = id;
		notify();
	};
	const feed = () => scroller?.querySelector<HTMLElement>(FEED) ?? null;
	const element = (id: string) =>
		scroller?.querySelector<HTMLElement>(`[data-transcript-item="${CSS.escape(id)}"]`) ?? null;
	const ownerOf = (node: EventTarget | null): HTMLElement | null => {
		if (!(node instanceof Element) || !scroller) return null;
		const item = node.closest<HTMLElement>(ITEM);
		return item && scroller.contains(item) ? item : null;
	};
	const nested = (item: HTMLElement) => item.parentElement?.closest(ITEM) != null;
	const toggleOf = (item: HTMLElement) =>
		Array.from(item.querySelectorAll<HTMLElement>(TOGGLE)).find(
			(toggle) => toggle.closest(ITEM) === item,
		) ?? null;
	const ownControls = (item: HTMLElement) =>
		Array.from(item.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
			(control) => control.closest(ITEM) === item && focusable(control),
		);
	const items = () =>
		options ? transcriptItems(options.rows, (id) => foldOverride(id) === true) : [];
	const latestRowIds = () => (options ? [options.newestRowId, options.latestRowId] : []);
	const park = () => feed()?.focus({ preventScroll: true });
	const cancel = () => {
		const pending = cancelPending;
		cancelPending = null;
		pending?.();
	};
	const holdsFocus = () => scroller?.contains(document.activeElement) === true;

	const show = (target: HTMLElement) => {
		if (!scroller || !options) return;
		const owner = ownerOf(target);
		const inset = owner && nested(owner) ? ACTIVITY_BREADCRUMB_HEIGHT : 0;
		if (sticksOut(target, scroller, inset)) {
			options.revealElement(target, {
				block: "nearest",
				provenance: "user-navigation",
				runway: "preserve",
				stability: "none",
				topInset: inset,
			});
		} else {
			const item = owner && items().find((entry) => entry.id === owner.dataset.transcriptItem);
			if (item && keyboardLeavesFollow(item, latestRowIds(), "focus")) options.leaveFollow();
		}
		target.focus({ preventScroll: true });
	};

	const toggleItem = (item: TranscriptNavItem, itemElement: HTMLElement) => {
		const control = toggleOf(itemElement);
		if (
			control?.getAttribute("aria-expanded") === "false" &&
			keyboardLeavesFollow(item, latestRowIds(), "expand")
		) {
			options?.leaveFollow();
		}
		control?.click();
	};

	const whenMounted = (id: string) => {
		cancel();
		let frame = 0;
		let frames = 0;
		const step = () => {
			frame = 0;
			if (!holdsFocus()) return;
			const target = element(id);
			if (target) {
				target.focus({ preventScroll: true });
				return;
			}
			frames += 1;
			if (frames < MOUNT_WAIT_FRAMES) frame = requestAnimationFrame(step);
		};
		step();
		cancelPending = () => cancelAnimationFrame(frame);
	};

	const reveal = (item: TranscriptNavItem, align: "start" | "center" | "end") => {
		cancel();
		const mounted = element(item.id);
		if (mounted) {
			show(mounted);
			return;
		}
		const current = options;
		if (!current || !scroller) return;
		if (!holdsFocus()) park();
		if (item.id === item.rowId && latestRowIds().includes(item.rowId)) {
			current.scrollToLatest();
			whenMounted(item.id);
			return;
		}
		const { rowId } = item;
		const cancelReveal = current.revealRow(
			rowId,
			() => options?.rows.findIndex((row) => row.id === rowId) ?? -1,
			align,
			(result) => {
				cancelPending = null;
				if (result !== "found" || !holdsFocus()) return;
				const target = element(item.id) ?? element(rowId);
				if (target) show(target);
			},
		);
		cancelPending = cancelReveal;
	};

	const moveTo = (list: TranscriptNavItem[], index: number, align: "start" | "center" | "end") => {
		const target = list[index];
		if (!target) return;
		setCursor(target.id, index);
		reveal(target, align);
	};

	const resolveCursor = (list: TranscriptNavItem[]): number => {
		if (cursor === null || !options) return -1;
		const visible = list.findIndex((item) => item.id === cursor);
		if (visible >= 0) return visible;
		const all = transcriptItems(options.rows, () => true);
		let node = all.find((item) => item.id === cursor);
		while (node?.parentId) {
			const parentId = node.parentId;
			const parent = list.findIndex((item) => item.id === parentId);
			if (parent >= 0) return parent;
			node = all.find((item) => item.id === parentId);
		}
		return list.length === 0 ? -1 : Math.min(cursorIndex, list.length - 1);
	};

	const entryElement = (): HTMLElement | null => {
		if (!scroller || !options) return null;
		for (const id of [cursor, options.newestRowId]) {
			const candidate = id ? element(id) : null;
			if (candidate && intersects(candidate, scroller)) return candidate;
		}
		const view = scroller;
		return (
			Array.from(view.querySelectorAll<HTMLElement>(ITEM)).find(
				(candidate) => !nested(candidate) && intersects(candidate, view),
			) ?? null
		);
	};

	const enter = (): boolean => {
		const target = entryElement();
		if (!target) return false;
		cancel();
		show(target);
		return true;
	};

	const revealCursor = () => {
		const list = items();
		const at = resolveCursor(list);
		if (at < 0) enter();
		else moveTo(list, at, "center");
	};

	const insetOf = (target: HTMLElement) => {
		const owner = ownerOf(target);
		return owner && nested(owner) ? ACTIVITY_BREADCRUMB_HEIGHT : 0;
	};

	const ownSpan = (target: HTMLElement, next: HTMLElement | null): ReadingSpan => {
		const rect = target.getBoundingClientRect();
		const bottom =
			next && next !== target && target.contains(next)
				? next.getBoundingClientRect().top
				: rect.bottom;
		return { top: rect.top, bottom: Math.max(rect.top, bottom) };
	};

	const spanAt = (list: TranscriptNavItem[], index: number, target: HTMLElement) =>
		ownSpan(target, element(list[index + 1]?.id ?? ""));

	const visibleEnd = (list: TranscriptNavItem[], direction: ReadingDirection) => {
		if (!scroller) return null;
		const view = scroller;
		const mounted = new Map(
			Array.from(view.querySelectorAll<HTMLElement>(ITEM), (target) => [
				target.dataset.transcriptItem ?? "",
				target,
			]),
		);
		const shown = list.flatMap((item, index) => {
			const target = mounted.get(item.id);
			if (!target) return [];
			const span = ownSpan(target, mounted.get(list[index + 1]?.id ?? "") ?? null);
			return spansOverlap(span, viewportBounds(view, insetOf(target))) ? [{ index, target }] : [];
		});
		return (direction > 0 ? shown[0] : shown.at(-1)) ?? null;
	};

	const land = (list: TranscriptNavItem[], index: number, target: HTMLElement) => {
		const item = list[index];
		if (!item) return;
		setCursor(item.id, index);
		target.focus({ preventScroll: true });
	};

	const step = (list: TranscriptNavItem[], index: number, direction: ReadingDirection) => {
		const next = list[index];
		if (!next || !scroller || !options) return;
		const target = element(next.id);
		if (!target) {
			moveTo(list, index, direction < 0 ? "start" : "end");
			return;
		}
		const delta = stepRevealDelta(
			viewportBounds(scroller, insetOf(target)),
			spanAt(list, index, target),
		);
		if (delta !== 0) options.scrollBy(delta);
		else if (keyboardLeavesFollow(next, latestRowIds(), "focus")) options.leaveFollow();
		land(list, index, target);
	};

	const readLine = (
		list: TranscriptNavItem[],
		index: number,
		itemElement: HTMLElement,
		direction: ReadingDirection,
	) => {
		if (!scroller || !options) return;
		const view = viewportBounds(scroller, insetOf(itemElement));
		const span = spanAt(list, index, itemElement);
		if (!spansOverlap(span, view)) {
			const shown = visibleEnd(list, direction);
			if (shown) {
				land(list, shown.index, shown.target);
				return;
			}
		}
		const delta = scrollBeforeStep(view, span, direction);
		const before = scroller.scrollTop;
		if (delta !== 0) options.scrollBy(delta);
		if (scroller.scrollTop === before) step(list, index + direction, direction);
	};

	const page = (
		list: TranscriptNavItem[],
		direction: ReadingDirection,
		from: HTMLElement | null,
	) => {
		if (!scroller || !options) return;
		options.scrollPage(direction);
		if (!from) return;
		const index = list.findIndex((item) => item.id === from.dataset.transcriptItem);
		const view = viewportBounds(scroller, insetOf(from));
		if (index >= 0 && spansOverlap(spanAt(list, index, from), view)) return;
		const shown = visibleEnd(list, 1);
		if (shown) land(list, shown.index, shown.target);
	};

	const edge = (list: TranscriptNavItem[], direction: ReadingDirection) => {
		const index = direction < 0 ? 0 : list.length - 1;
		const target = list[index];
		if (!target || !scroller || !options) return;
		setCursor(target.id, index);
		if (target.id === target.rowId && latestRowIds().includes(target.rowId)) {
			options.scrollToLatest();
		} else {
			const { scrollTop, scrollHeight, clientHeight } = scroller;
			options.scrollBy(direction < 0 ? -scrollTop : scrollHeight - clientHeight - scrollTop);
		}
		const mounted = element(target.id);
		if (mounted) mounted.focus({ preventScroll: true });
		else whenMounted(target.id);
	};

	const copy = (item: TranscriptNavItem) => {
		const text = transcriptItemCopyText(item);
		if (!text) return;
		void copyText(text).then((copied) => {
			if (copied) options?.onCopied();
		});
	};

	const openTarget = (item: TranscriptNavItem): string | null => {
		const path = transcriptItemFilePath(item);
		return path && options ? options.fileTarget(path) : null;
	};

	const open = (item: TranscriptNavItem) => {
		const target = openTarget(item);
		if (target) options?.openFile(target);
	};

	const openMenu = (item: TranscriptNavItem, itemElement: HTMLElement) => {
		const toggle = toggleOf(itemElement);
		const actions: TranscriptMenuAction[] = [];
		if (toggle)
			actions.push(toggle.getAttribute("aria-expanded") === "true" ? "collapse" : "expand");
		if (transcriptItemCopyText(item)) actions.push("copy");
		if (openTarget(item)) actions.push("open");
		if (actions.length === 0) return;
		menu = { itemId: item.id, actions };
		notify();
	};

	const act = (action: TranscriptKeyAction, itemElement: HTMLElement) => {
		const id = itemElement.dataset.transcriptItem ?? "";
		const list = items();
		const index = list.findIndex((item) => item.id === id);
		const item = list[index];
		if (!item) return;
		setCursor(id, index);
		switch (action.kind) {
			case "move": {
				const state = toggleOf(itemElement)?.getAttribute("aria-expanded");
				const move = resolveTreeMove(
					action.key,
					list.map((entry, at) => ({
						level: entry.level,
						expanded: at === index && state != null ? state === "true" : undefined,
					})),
					index,
				);
				if (move?.kind === "toggle") toggleItem(item, itemElement);
				else if (move?.kind === "focus") {
					moveTo(list, move.index, move.index < index ? "start" : "end");
				}
				return;
			}
			case "line":
				readLine(list, index, itemElement, action.direction);
				return;
			case "page":
				page(list, action.direction, itemElement);
				return;
			case "edge":
				edge(list, action.direction);
				return;
			case "toggle":
				toggleItem(item, itemElement);
				return;
			case "copy":
				copy(item);
				return;
			case "open":
				open(item);
				return;
			case "menu":
				openMenu(item, itemElement);
				return;
		}
	};

	const leave = (direction: -1 | 1) => {
		if (!scroller) return;
		const target = direction > 0 ? tabbableAfter(scroller, false) : tabbableBefore(scroller);
		target?.focus();
	};

	const tab = (event: KeyboardEvent, target: HTMLElement) => {
		const backward = event.shiftKey;
		const owner = ownerOf(target);
		if (!owner) {
			if (target === feed()) {
				event.preventDefault();
				if (backward) leave(-1);
				else revealCursor();
			} else if (target === scroller && !backward && enter()) {
				event.preventDefault();
			}
			return;
		}
		const stops = [owner, ...ownControls(owner)];
		let at = stops.indexOf(target);
		if (at < 0) at = stops.filter((stop) => stop === owner || follows(stop, target)).length - 1;
		const next = stops[at + (backward ? -1 : 1)];
		cancel();
		if (next && next !== owner) {
			const native = backward ? tabbableBefore(target) : tabbableAfter(target, true);
			if (native === next) return;
		}
		event.preventDefault();
		if (next) show(next);
		else leave(backward ? -1 : 1);
	};

	const onScrollerKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || isImeComposing(event) || !scroller) return;
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) return;
		if (event.key === "Tab") {
			if (!event.altKey && !event.ctrlKey && !event.metaKey) tab(event, target);
			return;
		}
		const parked = target === feed();
		if (!parked && ownerOf(target) !== target) return;
		const question = options?.waitingQuestion() ?? null;
		const action = keys && transcriptKeyAction(event, keys, parked, question !== null);
		if (!action) return;
		event.preventDefault();
		if (action.kind === "question") {
			cancel();
			if (question) focusAndReveal(question);
		} else if (action.kind === "leave") {
			cancel();
			options?.focusComposer();
		} else if (parked && action.kind === "page") {
			cancel();
			page(items(), action.direction, null);
		} else if (parked && action.kind === "edge") {
			cancel();
			edge(items(), action.direction);
		} else if (parked) revealCursor();
		else {
			cancel();
			act(action, target);
		}
	};

	const onDocumentKeyDown = (event: KeyboardEvent) => {
		if (
			event.key !== "Tab" ||
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			isImeComposing(event) ||
			!scroller
		) {
			return;
		}
		const active = document.activeElement;
		if (
			!(active instanceof HTMLElement) ||
			active === document.body ||
			scroller.contains(active) ||
			active.closest(LAYER)
		) {
			return;
		}
		const next = event.shiftKey ? tabbableBefore(active) : tabbableAfter(active, true);
		if (next && scroller.contains(next) && enter()) event.preventDefault();
	};

	const onFocusIn = (event: FocusEvent) => {
		const owner = ownerOf(event.target);
		if (owner) setCursor(owner.dataset.transcriptItem ?? null);
	};

	return {
		configure: (next, nextKeys) => {
			options = next;
			keys = nextKeys;
		},
		attach: (element) => {
			scroller = element;
			element.addEventListener("keydown", onScrollerKeyDown, true);
			element.addEventListener("focusin", onFocusIn);
			document.addEventListener("keydown", onDocumentKeyDown);
			return () => {
				cancel();
				element.removeEventListener("keydown", onScrollerKeyDown, true);
				element.removeEventListener("focusin", onFocusIn);
				document.removeEventListener("keydown", onDocumentKeyDown);
				if (scroller === element) scroller = null;
			};
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		isCurrent: (id) => cursor === id,
		menuFor: (id) => (menu?.itemId === id ? menu : null),
		runMenuAction: (itemId, action) => {
			const itemElement = element(itemId);
			const item = items().find((candidate) => candidate.id === itemId);
			if (!itemElement || !item) return;
			if (action === "copy") copy(item);
			else if (action === "open") open(item);
			else toggleItem(item, itemElement);
		},
		closeMenu: (itemId) => {
			if (menu?.itemId !== itemId) return;
			menu = null;
			notify();
		},
		restoreFocus: (itemId) => {
			const active = document.activeElement;
			if (active && active !== document.body && !holdsFocus()) return;
			element(itemId)?.focus({ preventScroll: true });
		},
		itemUnmounting: (id) => {
			if (menu?.itemId === id) {
				menu = null;
				notify();
			}
			if (element(id)?.contains(document.activeElement)) park();
		},
		focusNewest: (returned = false) => {
			const id = options?.newestRowId;
			if (!id || !scroller || !options) return;
			cancel();
			setCursor(
				id,
				items().findIndex((item) => item.id === id),
			);
			const mounted = element(id);
			if (!returned && mounted && intersects(mounted, scroller)) {
				mounted.focus({ preventScroll: true });
				return;
			}
			if (!holdsFocus()) park();
			if (!returned) options.scrollToLatest();
			whenMounted(id);
		},
		focusRow: (rowId) => {
			const target = element(rowId);
			if (!target) return;
			cancel();
			setCursor(rowId);
			target.focus({ preventScroll: true });
		},
		parkOnToolCall: (toolCallId) => {
			const rowId = options ? rowIdForToolCall(options.rows, toolCallId) : null;
			cancel();
			if (rowId !== null) {
				setCursor(
					rowId,
					items().findIndex((item) => item.id === rowId),
				);
			}
			const target = rowId === null ? null : element(rowId);
			if (target) target.focus({ preventScroll: true });
			else park();
		},
	};
}

export function useTranscriptNavigation(
	scroller: HTMLElement | null,
	options: TranscriptNavigationOptions,
): TranscriptNavigationController {
	const [controller] = useState(createTranscriptNavigation);
	const keys = useLocalKeys("transcript", LOCAL_KEY_DEFAULTS.transcript);
	useInsertionEffect(() => controller.configure(options, keys));
	useEffect(() => (scroller ? controller.attach(scroller) : undefined), [controller, scroller]);
	return controller;
}
