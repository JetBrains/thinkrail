import {
	type ComponentProps,
	type KeyboardEvent,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";
import { isImeComposing } from "./keyboard";

const CONTROLS =
	'button, a[href], input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="button"][tabindex]';

function toolbarControls(root: HTMLElement, selector: string): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
		(control) =>
			control.closest('[role="toolbar"]') === root &&
			!control.matches(':disabled, [aria-disabled="true"]') &&
			!control.closest('[hidden], [inert], [aria-hidden="true"]') &&
			control.getClientRects().length > 0 &&
			getComputedStyle(control).visibility === "visible",
	);
}

export function handleToolbarKeyDown(
	event: KeyboardEvent<HTMLElement>,
	{
		selector = CONTROLS,
		previousKey,
		nextKey,
	}: { selector?: string; previousKey?: string; nextKey?: string } = {},
) {
	if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
		return;
	if (isImeComposing(event.nativeEvent)) return;
	const root = event.currentTarget;
	const target = event.target;
	if (!(target instanceof HTMLElement) || target.closest('[role="toolbar"]') !== root) return;
	if (target.closest('input, select, textarea, [contenteditable="true"]')) return;
	const controls = toolbarControls(root, selector);
	const current = target.closest<HTMLElement>(selector);
	const index = current ? controls.indexOf(current) : -1;
	if (index < 0) return;
	const vertical = root.getAttribute("aria-orientation") === "vertical";
	const rtl = !vertical && getComputedStyle(root).direction === "rtl";
	const previous = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
	const next = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
	const nextIndex =
		event.key === "Home"
			? 0
			: event.key === "End"
				? controls.length - 1
				: event.key === next || event.key === nextKey
					? (index + 1) % controls.length
					: event.key === previous || event.key === previousKey
						? (index - 1 + controls.length) % controls.length
						: null;
	if (nextIndex === null) return;
	event.preventDefault();
	event.stopPropagation();
	controls[nextIndex]?.focus({ preventScroll: true });
	controls[nextIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function Toolbar({
	orientation = "horizontal",
	onKeyDown,
	ref,
	...props
}: Omit<ComponentProps<"div">, "role" | "aria-orientation"> & {
	orientation?: "horizontal" | "vertical";
}) {
	const root = useRef<HTMLDivElement>(null);
	const attach = useCallback(
		(element: HTMLDivElement | null) => {
			root.current = element;
			if (typeof ref === "function") {
				const cleanup = ref(element);
				if (cleanup)
					return () => {
						root.current = null;
						cleanup();
					};
			} else if (ref) ref.current = element;
			return undefined;
		},
		[ref],
	);
	useLayoutEffect(() => {
		const element = root.current;
		if (!element) return;
		let remembered: HTMLElement | undefined;
		const sync = () => {
			const controls = toolbarControls(element, CONTROLS);
			const focused = controls.find((control) => control === document.activeElement);
			remembered =
				focused ?? (remembered && controls.includes(remembered) ? remembered : controls[0]);
			for (const control of element.querySelectorAll<HTMLElement>(CONTROLS)) {
				if (control.closest('[role="toolbar"]') !== element) continue;
				const tabIndex = control === remembered ? 0 : -1;
				if (control.getAttribute("tabindex") !== String(tabIndex)) control.tabIndex = tabIndex;
			}
		};
		sync();
		element.addEventListener("focusin", sync);
		window.addEventListener("resize", sync);
		const observer = new MutationObserver(sync);
		observer.observe(element, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"disabled",
				"aria-disabled",
				"hidden",
				"inert",
				"aria-hidden",
				"class",
				"style",
				"tabindex",
			],
		});
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			observer.observe(parent, {
				attributes: true,
				attributeFilter: ["disabled", "hidden", "inert", "aria-hidden", "class", "style"],
			});
		}
		const resize = new ResizeObserver(sync);
		resize.observe(element);
		return () => {
			element.removeEventListener("focusin", sync);
			window.removeEventListener("resize", sync);
			observer.disconnect();
			resize.disconnect();
		};
	}, []);
	return (
		<div
			{...props}
			ref={attach}
			role="toolbar"
			aria-orientation={orientation}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				handleToolbarKeyDown(event);
			}}
		/>
	);
}
