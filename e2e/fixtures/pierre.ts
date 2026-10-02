import type { Locator } from "@playwright/test";

const LINE = "[data-line]";
const LINE_NUMBER = (line: string, type: string | null) =>
	`[data-column-number="${line}"]${type === null ? "" : `[data-line-type="${type}"]`}`;
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

async function pierreLineRef(
	surface: Locator,
	text: string,
	which: "first" | "last",
): Promise<{ line: string; type: string | null }> {
	const hit = surface.getByText(text, { exact: false });
	const ref = await (which === "first" ? hit.first() : hit.last()).evaluate((node, selector) => {
		const row = node.closest(selector);
		return row === null
			? null
			: { line: row.getAttribute("data-line"), type: row.getAttribute("data-line-type") };
	}, LINE);
	if (!ref?.line) throw new Error(`No Pierre line for ${JSON.stringify(text)}`);
	return { line: ref.line, type: ref.type };
}

export async function pierreLineNumber(
	surface: Locator,
	text: string,
	which: "first" | "last" = "last",
): Promise<string> {
	return (await pierreLineRef(surface, text, which)).line;
}

export async function selectPierreLine(
	surface: Locator,
	text: string,
	which: "first" | "last" = "last",
	modifiers: ("Shift" | "Alt" | "Control" | "Meta")[] = [],
): Promise<void> {
	const { line, type } = await pierreLineRef(surface, text, which);
	const gutter = surface.locator(LINE_NUMBER(line, type));
	await (which === "first" ? gutter.first() : gutter.last()).click({ modifiers });
}
