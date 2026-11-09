import { resultText, strArg } from "@thinkrail/extension-api/web";
import { isContextMenuKey } from "@thinkrail/ui/context-menu";
import type { LocalKeyEvent, LocalKeys } from "@thinkrail/ui/local-keys";
import { type ReadingDirection, readingCommand } from "@thinkrail/ui/reading";
import { parseSkillInvocation, userText } from "@/lib";
import { parseReviewPackage } from "./reviewPackage";
import type { ActivityStep, ChatRow } from "./rows";
import { specToolPaths } from "./tools/SpecToolCard";

export interface TranscriptNavItem {
	id: string;
	rowId: string;
	parentId: string | null;
	level: number;
	source: ChatRow | ActivityStep;
}

export type TranscriptMoveKey = "ArrowLeft" | "ArrowRight";

export type TranscriptKeyAction =
	| { kind: "move"; key: TranscriptMoveKey }
	| { kind: "line"; direction: ReadingDirection }
	| { kind: "page"; direction: ReadingDirection }
	| { kind: "edge"; direction: ReadingDirection }
	| { kind: "toggle" }
	| { kind: "copy" }
	| { kind: "open" }
	| { kind: "menu" }
	| { kind: "leave" }
	| { kind: "question" };

const LOCAL_ACTIONS: Readonly<Record<string, TranscriptKeyAction>> = {
	"transcript.copy": { kind: "copy" },
	"transcript.open": { kind: "open" },
};

const OPENABLE_SPEC_TOOLS = new Set(["spec_create", "spec_get", "spec_update"]);
const OPENABLE_FILE_TOOLS = new Set(["read", "edit", "write"]);

function flatStepCount(steps: readonly ActivityStep[]): number {
	return steps.reduce(
		(count, step) => count + 1 + (step.kind === "thinking" ? step.tools.length : 0),
		0,
	);
}

export function transcriptItems(
	rows: readonly ChatRow[],
	expanded: (id: string) => boolean,
): TranscriptNavItem[] {
	const items: TranscriptNavItem[] = [];
	for (const row of rows) {
		items.push({ id: row.id, rowId: row.id, parentId: null, level: 1, source: row });
		if (row.kind !== "activity" || flatStepCount(row.steps) < 2 || !expanded(row.id)) continue;
		for (const step of row.steps) {
			items.push({ id: step.id, rowId: row.id, parentId: row.id, level: 2, source: step });
			if (step.kind !== "thinking" || !expanded(step.id)) continue;
			for (const tool of step.tools) {
				items.push({ id: tool.id, rowId: row.id, parentId: step.id, level: 3, source: tool });
			}
		}
	}
	return items;
}

export function keyboardLeavesFollow(
	item: Pick<TranscriptNavItem, "rowId" | "parentId">,
	latestRowIds: readonly (string | null)[],
	change: "focus" | "expand",
): boolean {
	return latestRowIds.includes(item.rowId) && (change === "expand" || item.parentId !== null);
}

function subjectOf(item: TranscriptNavItem): ChatRow | ActivityStep {
	const { source } = item;
	if (source.kind !== "activity" || flatStepCount(source.steps) !== 1) return source;
	return source.steps[0] ?? source;
}

export function transcriptItemCopyText(item: TranscriptNavItem): string | null {
	const subject = subjectOf(item);
	switch (subject.kind) {
		case "user": {
			const text = userText(subject.message.content);
			return parseSkillInvocation(text) || parseReviewPackage(text) ? null : text || null;
		}
		case "markdown":
		case "thinking":
		case "error":
		case "system":
			return subject.text || null;
		case "tool":
			return resultText(subject.tool?.raw) || null;
		default:
			return null;
	}
}

export function transcriptItemFilePath(item: TranscriptNavItem): string | null {
	const subject = subjectOf(item);
	if (subject.kind !== "tool") return null;
	if (OPENABLE_FILE_TOOLS.has(subject.toolName)) return strArg(subject.args, "path") || null;
	if (!OPENABLE_SPEC_TOOLS.has(subject.toolName)) return null;
	return specToolPaths(subject.toolName, subject.args, subject.tool?.raw)[0] ?? null;
}

export function transcriptKeyAction(
	event: LocalKeyEvent,
	keys: Pick<LocalKeys, "match">,
	parked = false,
	questionWaiting = false,
): TranscriptKeyAction | null {
	if (isContextMenuKey(event)) {
		return event.altKey || event.ctrlKey || event.metaKey ? null : { kind: "menu" };
	}
	const local = keys.match(event);
	const action = LOCAL_ACTIONS[local ?? ""];
	if (action) return action;
	const reading = readingCommand(event, keys, local);
	if (reading?.kind === "side") {
		return { kind: "move", key: reading.direction < 0 ? "ArrowLeft" : "ArrowRight" };
	}
	if (reading) return reading;
	if (local !== null || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
		return null;
	}
	switch (event.key) {
		case "Enter":
			return { kind: "toggle" };
		case "Escape":
			if (questionWaiting) return { kind: "question" };
			return parked ? null : { kind: "leave" };
		default:
			return null;
	}
}

export function newestContentRowId(chronologicalRows: readonly ChatRow[]): string | null {
	const last = chronologicalRows.at(-1);
	if (last?.kind !== "divider") return last?.id ?? null;
	return chronologicalRows.at(-2)?.id ?? null;
}
