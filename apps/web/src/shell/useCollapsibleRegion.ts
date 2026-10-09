import type { ImperativePanelHandle } from "@thinkrail/ui/resizable";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

type PendingFocus = "inside" | "rail";

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

export interface CollapsibleRegion<T extends HTMLElement = HTMLElement> {
	collapsed: boolean;
	regionRef: RefObject<HTMLElement | null>;
	contentRef: RefObject<T | null>;
	onCollapse: () => void;
	onDragging: (dragging: boolean) => void;
	onExpand: () => void;
	panelRef: RefObject<ImperativePanelHandle | null>;
	railRef: RefObject<HTMLButtonElement | null>;
	toggle: () => void;
}

export function useCollapsibleRegion<T extends HTMLElement = HTMLElement>(
	storageId: string,
): CollapsibleRegion<T> {
	const panelRef = useRef<ImperativePanelHandle>(null);
	const regionRef = useRef<HTMLElement>(null);
	const contentRef = useRef<T>(null);
	const railRef = useRef<HTMLButtonElement>(null);
	const lastInsideRef = useRef<HTMLElement | null>(null);
	const pendingFocusRef = useRef<PendingFocus | null>(null);
	const draggingRef = useRef(false);
	const dragStartSizeRef = useRef<number | null>(null);
	const requestedCollapseRef = useRef(false);
	const storageKey = expandSizeStorageKey(storageId);
	const [initialExpandSize] = useState(() => readExpandSize(storageKey));
	const expandSizeRef = useRef<number | null>(initialExpandSize);
	const [collapsed, setCollapsed] = useState(false);

	useEffect(() => {
		const rememberFocus = (event: FocusEvent) => {
			const target = event.target;
			if (target instanceof HTMLElement && contentRef.current?.contains(target))
				lastInsideRef.current = target;
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

	useLayoutEffect(() => {
		const pending = pendingFocusRef.current;
		if (!pending) return;
		if (!collapsed && pending === "inside") {
			pendingFocusRef.current = null;
			focusInside();
			return;
		}
		if (collapsed && pending === "rail") {
			pendingFocusRef.current = null;
			focusElement(railRef.current);
		}
	}, [collapsed, focusInside]);

	const onCollapse = useCallback(() => {
		if (dragStartSizeRef.current !== null) {
			expandSizeRef.current = dragStartSizeRef.current;
			writeExpandSize(storageKey, expandSizeRef.current);
		} else if (requestedCollapseRef.current) {
			expandSizeRef.current = null;
			writeExpandSize(storageKey, null);
		}
		if (!draggingRef.current) dragStartSizeRef.current = null;
		requestedCollapseRef.current = false;
		if (!pendingFocusRef.current) {
			const active = document.activeElement;
			if (
				active instanceof HTMLElement &&
				(regionRef.current?.contains(active) || active.matches(RESIZE_HANDLE_SELECTOR))
			) {
				pendingFocusRef.current = "rail";
			}
		}
		setCollapsed(true);
	}, [storageKey]);

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

	const toggle = useCallback(() => {
		const panel = panelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) {
			pendingFocusRef.current = "inside";
			const expandSize = expandSizeRef.current;
			if (expandSize === null) panel.expand();
			else panel.expand(expandSize);
			return;
		}
		requestedCollapseRef.current = true;
		panel.collapse();
	}, []);

	return {
		collapsed,
		regionRef,
		contentRef,
		onCollapse,
		onDragging,
		onExpand,
		panelRef,
		railRef,
		toggle,
	};
}
