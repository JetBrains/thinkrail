import type { ChatRow } from "./rows";
import { resolveProminence } from "./toolRegistry";

const MAX_ESTIMATED_HEIGHT = 20_000;
const MIN_ESTIMATED_HEIGHT = 40;
const PROSE_COLUMNS = 72;
const PROSE_LINE_HEIGHT = 22;
const CODE_LINE_HEIGHT = 20;
const BLOCK_GAP = 10;

export type RowHeightEstimateCache = Map<string, number>;

function clampHeight(height: number): number {
	if (!Number.isFinite(height)) return MAX_ESTIMATED_HEIGHT;
	return Math.min(MAX_ESTIMATED_HEIGHT, Math.max(MIN_ESTIMATED_HEIGHT, Math.ceil(height)));
}

function wrappedLines(text: string, columns = PROSE_COLUMNS): number {
	return Math.max(1, Math.ceil(text.length / columns));
}

function fenceStart(line: string): { marker: "`" | "~"; length: number } | null {
	const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
	const fence = match?.[1];
	if (!fence) return null;
	const marker = fence[0];
	if (marker !== "`" && marker !== "~") return null;
	return { marker, length: fence.length };
}

function fenceEnd(line: string, marker: "`" | "~", length: number): boolean {
	const expression = marker === "`" ? /^\s{0,3}(`{3,})\s*$/ : /^\s{0,3}(~{3,})\s*$/;
	return (expression.exec(line)?.[1]?.length ?? 0) >= length;
}

export function estimateMarkdownHeight(text: string): number {
	let height = 16;
	let blankRun = false;
	let fence: { marker: "`" | "~"; length: number } | null = null;
	let codeLines = 0;

	const finishCodeBlock = () => {
		height += Math.max(1, codeLines) * CODE_LINE_HEIGHT + 20;
		codeLines = 0;
	};

	for (const line of text.split(/\r?\n/)) {
		if (fence) {
			if (fenceEnd(line, fence.marker, fence.length)) {
				finishCodeBlock();
				fence = null;
			} else {
				codeLines += 1;
			}
			if (height >= MAX_ESTIMATED_HEIGHT) return MAX_ESTIMATED_HEIGHT;
			continue;
		}

		const openingFence = fenceStart(line);
		if (openingFence) {
			fence = openingFence;
			blankRun = false;
			continue;
		}

		if (line.trim().length === 0) {
			if (!blankRun) height += BLOCK_GAP;
			blankRun = true;
		} else {
			height += wrappedLines(line) * PROSE_LINE_HEIGHT;
			blankRun = false;
		}
		if (height >= MAX_ESTIMATED_HEIGHT) return MAX_ESTIMATED_HEIGHT;
	}

	if (fence) finishCodeBlock();
	return clampHeight(height);
}

function userText(row: Extract<ChatRow, { kind: "user" }>): string {
	if (typeof row.message.content === "string") return row.message.content;
	return row.message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function userAttachmentCount(row: Extract<ChatRow, { kind: "user" }>): number {
	return typeof row.message.content === "string"
		? 0
		: row.message.content.filter((block) => block.type === "image").length;
}

function collectStrings(value: unknown, result: string[], seen: Set<unknown>): void {
	if (typeof value === "string") {
		result.push(value);
		return;
	}
	if (!value || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const item of value) collectStrings(item, result, seen);
		return;
	}
	for (const key of Object.keys(value).sort()) {
		collectStrings((value as Record<string, unknown>)[key], result, seen);
	}
}

function estimateToolPayload(row: Extract<ChatRow, { kind: "tool" }>, baseHeight: number): number {
	const strings: string[] = [];
	const seen = new Set<unknown>();
	collectStrings(row.args, strings, seen);
	collectStrings(row.tool?.raw, strings, seen);
	let height = baseHeight;
	for (const text of strings) {
		height += estimateMarkdownHeight(text);
		if (height >= MAX_ESTIMATED_HEIGHT) return MAX_ESTIMATED_HEIGHT;
	}
	return clampHeight(height);
}

function estimateToolHeight(row: Extract<ChatRow, { kind: "tool" }>): number {
	if (row.toolName === "ask_user_question") return estimateToolPayload(row, 120);
	const status = row.tool?.status ?? (row.dead ? "error" : "running");
	const expanded =
		status === "error" || (status === "done" && resolveProminence(row.toolName).defaultExpanded);
	return expanded ? estimateToolPayload(row, 64) : 48;
}

export function estimateChatRowHeight(row: ChatRow): number {
	switch (row.kind) {
		case "markdown":
			return estimateMarkdownHeight(row.text);
		case "user":
			return clampHeight(
				24 + wrappedLines(userText(row), 62) * PROSE_LINE_HEIGHT + userAttachmentCount(row) * 28,
			);
		case "system":
			return clampHeight(20 + wrappedLines(row.text) * PROSE_LINE_HEIGHT);
		case "error":
			return clampHeight(28 + wrappedLines(row.text) * PROSE_LINE_HEIGHT);
		case "subagentCompletion":
			return 64;
		case "tool":
			return estimateToolHeight(row);
		case "activity":
			return 48;
		case "compaction":
			return 48;
		case "retry":
			return 40;
		case "divider":
			return 48;
	}
}

export function estimateChatRowHeights(
	rows: readonly ChatRow[],
	cache: RowHeightEstimateCache,
): number[] {
	const activeIds = new Set<string>();
	const heights = rows.map((row) => {
		activeIds.add(row.id);
		const cached = cache.get(row.id);
		if (cached !== undefined) return cached;
		const height = estimateChatRowHeight(row);
		cache.set(row.id, height);
		return height;
	});
	for (const id of cache.keys()) {
		if (!activeIds.has(id)) cache.delete(id);
	}
	return heights;
}
