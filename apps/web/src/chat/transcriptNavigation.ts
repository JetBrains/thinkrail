import { resultText, strArg } from "@thinkrail/extension-api/web";
import { isContextMenuKey } from "@thinkrail/ui/context-menu";
import { hasPlatformModifier } from "@thinkrail/ui/keyboard";
import { HJKL_KEYS, TRANSCRIPT_KEYS } from "@/keybindings";
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

export type TranscriptMoveKey =
	| "ArrowUp"
	| "ArrowDown"
	| "ArrowLeft"
	| "ArrowRight"
	| "Home"
	| "End";

export type TranscriptKeyAction =
	| { kind: "move"; key: TranscriptMoveKey }
	| { kind: "page"; direction: -1 | 1 }
	| { kind: "toggle" }
	| { kind: "copy" }
	| { kind: "open" }
	| { kind: "menu" }
	| { kind: "leave" };

type KeyEventLike = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;

const MOVE_KEYS: Readonly<Record<string, TranscriptMoveKey>> = {
	ArrowUp: "ArrowUp",
	ArrowDown: "ArrowDown",
	ArrowLeft: "ArrowLeft",
	ArrowRight: "ArrowRight",
	Home: "Home",
	End: "End",
	[HJKL_KEYS.up.key]: "ArrowUp",
	[HJKL_KEYS.down.key]: "ArrowDown",
	[HJKL_KEYS.left.key]: "ArrowLeft",
	[HJKL_KEYS.right.key]: "ArrowRight",
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

export function transcriptKeyAction(event: KeyEventLike): TranscriptKeyAction | null {
	if (isContextMenuKey(event)) {
		return event.altKey || event.ctrlKey || event.metaKey ? null : { kind: "menu" };
	}
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return null;
	const move = MOVE_KEYS[event.key];
	if (move) return { kind: "move", key: move };
	switch (event.key) {
		case "PageUp":
			return { kind: "page", direction: -1 };
		case "PageDown":
			return { kind: "page", direction: 1 };
		case "Enter":
			return { kind: "toggle" };
		case "Escape":
			return { kind: "leave" };
		case TRANSCRIPT_KEYS.copy.key:
			return { kind: "copy" };
		case TRANSCRIPT_KEYS.open.key:
			return { kind: "open" };
		default:
			return null;
	}
}

export function isEnterTranscriptKey(event: KeyEventLike, platform?: string): boolean {
	return (
		event.key === TRANSCRIPT_KEYS.enter.key &&
		hasPlatformModifier(event, platform) &&
		!event.altKey &&
		!event.shiftKey
	);
}

export function composerTranscriptStep(
	multiline: boolean,
	caretAtStart: boolean,
): "enter" | "caretToStart" {
	return multiline && !caretAtStart ? "caretToStart" : "enter";
}

export function newestContentRowId(chronologicalRows: readonly ChatRow[]): string | null {
	const last = chronologicalRows.at(-1);
	if (last?.kind !== "divider") return last?.id ?? null;
	return chronologicalRows.at(-2)?.id ?? null;
}
