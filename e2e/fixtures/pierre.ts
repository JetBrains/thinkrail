import type { Locator } from "@playwright/test";

const LINE = "[data-line]";
const LINE_NUMBER = (line: string) => `[data-column-number="${line}"]`;
const COLLAPSED_CONTEXT = "[data-unmodified-lines]";
const DELETIONS_SIDE = "[data-deletions]";

export function pierreLines(surface: Locator, text?: string): Locator {
	return surface.locator(LINE, text === undefined ? {} : { hasText: text });
}

export function pierreCollapsedContext(surface: Locator): Locator {
	return surface.locator(COLLAPSED_CONTEXT);
}

export function pierreDeletionsSide(surface: Locator): Locator {
	return surface.locator(DELETIONS_SIDE);
}

export async function pierreLineNumber(
	surface: Locator,
	text: string,
	which: "first" | "last" = "last",
): Promise<string> {
	const hit = surface.getByText(text, { exact: false });
	const lineNumber = await (which === "first" ? hit.first() : hit.last()).evaluate(
		(node, selector) => node.closest(selector)?.getAttribute("data-line"),
		LINE,
	);
	if (!lineNumber) throw new Error(`No Pierre line for ${JSON.stringify(text)}`);
	return lineNumber;
}

export async function selectPierreLine(
	surface: Locator,
	text: string,
	which: "first" | "last" = "last",
): Promise<void> {
	const lineNumber = await pierreLineNumber(surface, text, which);
	const gutter = surface.locator(LINE_NUMBER(lineNumber));
	await (which === "first" ? gutter.first() : gutter.last()).click();
}
