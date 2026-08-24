import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "../components/ui/resizable";
import { STORAGE_PREFIX } from "../constants/branding";

const FOCUSABLE_SELECTOR = [
	"button:not(:disabled)",
	"a[href]",
	"input:not(:disabled)",
	"select:not(:disabled)",
	"textarea:not(:disabled)",
	'[contenteditable="true"]',
	'[tabindex]:not([tabindex="-1"])',
].join(",");

const RESIZE_HANDLE_SELECTOR = "[data-panel-resize-handle-enabled]";

type PendingFocus = "inside" | "outside" | "rail";

function expandSizeStorageKey(storageId: string): string {
	return `${STORAGE_PREFIX}panel-expand-size-${storageId}`;
}

function readExpandSize(storageKey: string): number | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const size = Number(localStorage.getItem(storageKey));
		return size > 0 && size <= 100 ? size : null;
	} catch {
		return null;
	}
}

function writeExpandSize(storageKey: string, size: number | null): void {
	try {
		if (size === null) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, String(size));
	} catch {}
}

function canReceiveFocus(element: HTMLElement): boolean {
	return (
		element.isConnected &&
		element.getClientRects().length > 0 &&
		element.closest("[inert]") === null &&
		element.closest('[aria-hidden="true"]') === null &&
		!element.matches(":disabled")
	);
}

function focusElement(element: HTMLElement | null): boolean {
	if (!element || !canReceiveFocus(element)) return false;
	element.focus();
	return document.activeElement === element || element.contains(document.activeElement);
}

function preferredFocusable(container: HTMLElement): HTMLElement | null {
	const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		canReceiveFocus,
	);
	return (
		candidates.find(
			(element) =>
				element.dataset.active === "true" || element.closest('[data-active="true"]') !== null,
		) ??
		candidates[0] ??
		null
	);
}

export function useCollapsibleRegion<T extends HTMLElement = HTMLElement>(
	outsideFallbackRef: RefObject<HTMLElement | null>,
	storageId: string,
) {
	const panelRef = useRef<ImperativePanelHandle>(null);
	const contentRef = useRef<T>(null);
	const railRef = useRef<HTMLButtonElement>(null);
	const lastInsideRef = useRef<HTMLElement | null>(null);
	const lastOutsideRef = useRef<HTMLElement | null>(null);
	const pendingFocusRef = useRef<PendingFocus | null>(null);
	const draggingRef = useRef(false);
	const dragStartSizeRef = useRef<number | null>(null);
	const requestedCollapseRef = useRef(false);
	const storageKeyRef = useRef(expandSizeStorageKey(storageId));
	const expandSizeRef = useRef<number | null>(readExpandSize(storageKeyRef.current));
	const [collapsed, setCollapsed] = useState(false);

	useEffect(() => {
		const rememberFocus = (event: FocusEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (contentRef.current?.contains(target)) {
				lastInsideRef.current = target;
				return;
			}
			if (!railRef.current?.contains(target)) lastOutsideRef.current = target;
		};
		window.addEventListener("focusin", rememberFocus);
		return () => window.removeEventListener("focusin", rememberFocus);
	}, []);

	const focusInside = useCallback(() => {
		const content = contentRef.current;
		if (!content) return;
		if (focusElement(lastInsideRef.current)) return;
		if (focusElement(preferredFocusable(content))) return;
		focusElement(content);
	}, []);

	const focusOutside = useCallback(() => {
		if (focusElement(lastOutsideRef.current)) return;
		const fallback = outsideFallbackRef.current;
		if (!fallback) return;
		if (focusElement(preferredFocusable(fallback))) return;
		focusElement(fallback);
	}, [outsideFallbackRef]);

	useLayoutEffect(() => {
		const pending = pendingFocusRef.current;
		if (!pending) return;
		if (!collapsed && pending === "inside") {
			pendingFocusRef.current = null;
			focusInside();
			return;
		}
		if (collapsed && pending === "outside") {
			pendingFocusRef.current = null;
			focusOutside();
			return;
		}
		if (collapsed && pending === "rail") {
			pendingFocusRef.current = null;
			focusElement(railRef.current);
		}
	}, [collapsed, focusInside, focusOutside]);

	const onCollapse = useCallback(() => {
		if (dragStartSizeRef.current !== null) {
			expandSizeRef.current = dragStartSizeRef.current;
			writeExpandSize(storageKeyRef.current, expandSizeRef.current);
		} else if (requestedCollapseRef.current) {
			expandSizeRef.current = null;
			writeExpandSize(storageKeyRef.current, null);
		}
		if (!draggingRef.current) dragStartSizeRef.current = null;
		requestedCollapseRef.current = false;
		if (!pendingFocusRef.current) {
			const active = document.activeElement;
			if (
				active instanceof HTMLElement &&
				(contentRef.current?.contains(active) || active.matches(RESIZE_HANDLE_SELECTOR))
			) {
				pendingFocusRef.current = "rail";
			}
		}
		setCollapsed(true);
	}, []);

	const onExpand = useCallback(() => {
		if (!draggingRef.current) dragStartSizeRef.current = null;
		requestedCollapseRef.current = false;
		setCollapsed(false);
	}, []);

	const onDragging = useCallback((dragging: boolean) => {
		draggingRef.current = dragging;
		if (!dragging) {
			dragStartSizeRef.current = null;
			return;
		}
		const panel = panelRef.current;
		if (panel?.isExpanded()) dragStartSizeRef.current = panel.getSize();
	}, []);

	const openAndFocus = useCallback(() => {
		const panel = panelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) {
			pendingFocusRef.current = "inside";
			const expandSize = expandSizeRef.current;
			if (expandSize === null) panel.expand();
			else panel.expand(expandSize);
			return;
		}
		focusInside();
	}, [focusInside]);

	const focusOrCollapse = useCallback(() => {
		const panel = panelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) {
			openAndFocus();
			return;
		}
		const active = document.activeElement;
		if (active instanceof HTMLElement && contentRef.current?.contains(active)) {
			pendingFocusRef.current = "outside";
			requestedCollapseRef.current = true;
			panel.collapse();
			return;
		}
		focusInside();
	}, [focusInside, openAndFocus]);

	return {
		collapsed,
		contentRef,
		focusOrCollapse,
		onCollapse,
		onDragging,
		onExpand,
		openAndFocus,
		panelRef,
		railRef,
	};
}
