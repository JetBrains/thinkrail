import { expect, type Locator } from "@playwright/test";

/** Every box and text run inside `dialog` stays in its bounds, no inner scroller scrolls sideways, and `dialog` stays in the window. */
export async function expectDialogContained(dialog: Locator): Promise<void> {
	await expect(dialog).toBeVisible();
	const problems = await dialog.evaluate((root) => {
		const TOLERANCE = 1;
		const found: string[] = [];
		const bounds = root.getBoundingClientRect();
		const scrollsVertically = getComputedStyle(root).overflowY !== "visible";

		const name = (el: Element) => {
			const label = el.getAttribute("data-testid") ?? el.textContent?.trim().slice(0, 40);
			return `<${el.tagName.toLowerCase()}> ${label ?? ""}`;
		};

		const clippedInside = (el: Element) => {
			for (let cur = el.parentElement; cur && cur !== root; cur = cur.parentElement) {
				const style = getComputedStyle(cur);
				if (style.overflowX !== "visible" || style.overflowY !== "visible") return true;
			}
			return false;
		};

		const report = (el: Element, rect: DOMRect) => {
			if (rect.width === 0 || rect.height === 0 || clippedInside(el)) return;
			const sideways = rect.left < bounds.left - TOLERANCE || rect.right > bounds.right + TOLERANCE;
			const vertical =
				!scrollsVertically &&
				(rect.top < bounds.top - TOLERANCE || rect.bottom > bounds.bottom + TOLERANCE);
			if (sideways || vertical) found.push(`${name(el)} leaves the dialog`);
		};

		for (const el of root.querySelectorAll("*")) {
			const style = getComputedStyle(el);
			const hidden =
				style.visibility === "hidden" ||
				style.clipPath !== "none" ||
				style.clip !== "auto" ||
				el.closest("[data-radix-popper-content-wrapper]") !== null;
			if (!hidden) report(el, el.getBoundingClientRect());
		}

		const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		while (text.nextNode()) {
			const parent = text.currentNode.parentElement;
			if (!parent || !text.currentNode.textContent?.trim()) continue;
			const parentStyle = getComputedStyle(parent);
			if (parentStyle.clipPath !== "none" || parentStyle.clip !== "auto") continue;
			const range = document.createRange();
			range.selectNodeContents(text.currentNode);
			for (const rect of range.getClientRects()) report(parent, rect);
		}

		if (root.scrollWidth > root.clientWidth + TOLERANCE) found.push("the dialog scrolls sideways");
		for (const el of root.querySelectorAll("*")) {
			const { overflowX } = getComputedStyle(el);
			const scrolls = overflowX === "auto" || overflowX === "scroll";
			if (scrolls && el.scrollWidth > el.clientWidth + TOLERANCE) {
				found.push(`${name(el)} scrolls sideways`);
			}
		}
		if (
			bounds.left < -TOLERANCE ||
			bounds.top < -TOLERANCE ||
			bounds.right > window.innerWidth + TOLERANCE ||
			bounds.bottom > window.innerHeight + TOLERANCE
		) {
			found.push("the dialog leaves the window");
		}
		return found;
	});
	expect(problems).toEqual([]);
}
