import { describe, expect, test } from "bun:test";
import { type LocalKeyEvent, localKeys } from "@thinkrail/ui/local-keys";
import { LOCAL_KEY_DEFAULTS } from "@/keybindings";
import { resolveTreeMove } from "@/lib";
import {
	type ActivityStep,
	type ChatRow,
	projectRows,
	type RoutineToolStep,
	rowIdForToolCall,
} from "./rows";
import {
	composerShiftTabOut,
	composerTranscriptStep,
	keyboardLeavesFollow,
	newestContentRowId,
	type TranscriptNavItem,
	transcriptItemCopyText,
	transcriptItemFilePath,
	transcriptItems,
	transcriptKeyAction,
} from "./transcriptNavigation";

function tool(id: string, toolName = "read", args: Record<string, unknown> = {}): RoutineToolStep {
	return {
		kind: "tool",
		id,
		toolCallId: id,
		toolName,
		args,
		tool: { status: "done", raw: { content: [{ type: "text", text: `${id} output` }] } },
		dead: false,
		streaming: false,
	} as RoutineToolStep;
}

function thinking(id: string, tools: RoutineToolStep[] = []): ActivityStep {
	return { kind: "thinking", id, text: `${id} thought`, streaming: false, tools };
}

const user = (id: string, text = id): ChatRow => ({
	kind: "user",
	id,
	message: { role: "user", content: text, timestamp: 0 },
});
const answer = (id: string): ChatRow => ({ kind: "markdown", id, text: `${id} answer` });
const activity = (id: string, steps: ActivityStep[]): ChatRow => ({
	kind: "activity",
	id,
	steps,
	live: false,
});

const rows: ChatRow[] = [
	user("u1"),
	activity("activity:t1", [tool("t1"), thinking("a1:thinking:1", [tool("t2"), tool("t3")])]),
	answer("a2"),
	user("u2"),
	activity("activity:t4", [tool("t4")]),
	answer("a3"),
];

const ids = (items: TranscriptNavItem[]) => items.map((item) => item.id);
const levels = (items: TranscriptNavItem[]) => items.map((item) => item.level);

describe("transcriptItems", () => {
	test("lists one item per row while every group is folded", () => {
		expect(ids(transcriptItems(rows, () => false))).toEqual([
			"u1",
			"activity:t1",
			"a2",
			"u2",
			"activity:t4",
			"a3",
		]);
	});

	test("nests the steps of an expanded activity and the tools of an expanded thought", () => {
		const open = new Set(["activity:t1"]);
		const items = transcriptItems(rows, (id) => open.has(id));
		expect(ids(items)).toEqual([
			"u1",
			"activity:t1",
			"t1",
			"a1:thinking:1",
			"a2",
			"u2",
			"activity:t4",
			"a3",
		]);
		open.add("a1:thinking:1");
		const deeper = transcriptItems(rows, (id) => open.has(id));
		expect(ids(deeper).slice(1, 6)).toEqual(["activity:t1", "t1", "a1:thinking:1", "t2", "t3"]);
		expect(levels(deeper).slice(1, 6)).toEqual([1, 2, 2, 3, 3]);
		expect(deeper.find((item) => item.id === "t2")?.parentId).toBe("a1:thinking:1");
		expect(deeper.find((item) => item.id === "t2")?.rowId).toBe("activity:t1");
	});

	test("names the row that holds a tool call, a step nested in a thought included", () => {
		const ask: ChatRow = { ...tool("ask-1", "ask_user_question"), kind: "tool", id: "tool:ask-1" };
		const withAsk = [...rows, ask];
		expect(rowIdForToolCall(withAsk, "ask-1")).toBe("tool:ask-1");
		expect(rowIdForToolCall(withAsk, "t3")).toBe("activity:t1");
		expect(rowIdForToolCall(withAsk, "missing")).toBeNull();
	});

	test("never nests the single step a bare activity row already shows", () => {
		expect(ids(transcriptItems(rows, () => true)).filter((id) => id === "t4")).toEqual([]);
	});

	test("follows newest-first projection for rows but keeps the steps inside a row in order", () => {
		const projected = projectRows(rows, "newest-first");
		const open = new Set(["activity:t1", "a1:thinking:1"]);
		expect(ids(transcriptItems(projected, (id) => open.has(id)))).toEqual([
			"a3",
			"activity:t4",
			"u2",
			"a2",
			"activity:t1",
			"t1",
			"a1:thinking:1",
			"t2",
			"t3",
			"u1",
		]);
	});

	test("a fold change rebuilds the visible list and tree moves follow it", () => {
		const open = new Set<string>();
		const model = () =>
			transcriptItems(rows, (id) => open.has(id)).map((item) => ({
				level: item.level,
				expanded: item.id === "activity:t1" ? open.has(item.id) : undefined,
			}));
		expect(resolveTreeMove("ArrowRight", model(), 1)).toEqual({ kind: "toggle" });
		open.add("activity:t1");
		expect(resolveTreeMove("ArrowRight", model(), 1)).toEqual({ kind: "focus", index: 2 });
		expect(resolveTreeMove("ArrowLeft", model(), 3)).toEqual({ kind: "focus", index: 1 });
		expect(resolveTreeMove("ArrowDown", model(), 3)).toEqual({ kind: "focus", index: 4 });
	});
});

describe("leaving follow from the keyboard", () => {
	const latestGroup = activity("activity:t5", [
		tool("t5"),
		thinking("a5:thinking:1", [tool("t6"), tool("t7")]),
	]);
	const items = transcriptItems([...rows, latestGroup], () => true);
	const latest = [latestGroup.id, "a5:divider"];
	const leaves = (id: string, change: "focus" | "expand") => {
		const found = items.find((candidate) => candidate.id === id);
		if (!found) throw new Error(`missing ${id}`);
		return keyboardLeavesFollow(found, latest, change);
	};

	test("focus entering any step of the latest row leaves follow", () => {
		expect(leaves("t5", "focus")).toBe(true);
		expect(leaves("a5:thinking:1", "focus")).toBe(true);
		expect(leaves("t7", "focus")).toBe(true);
	});

	test("focus on the latest row itself or on a step elsewhere keeps follow", () => {
		expect(leaves("activity:t5", "focus")).toBe(false);
		expect(leaves("t1", "focus")).toBe(false);
		expect(leaves("t2", "focus")).toBe(false);
		expect(leaves("a3", "focus")).toBe(false);
	});

	test("a keyboard expand leaves follow only on the latest row", () => {
		expect(leaves("activity:t5", "expand")).toBe(true);
		expect(leaves("a5:thinking:1", "expand")).toBe(true);
		expect(leaves("activity:t1", "expand")).toBe(false);
		expect(leaves("a1:thinking:1", "expand")).toBe(false);
	});
});

const LETTER_CODE = /^[a-z]$/i;

const press = (init: Partial<KeyboardEvent> & { key: string }): LocalKeyEvent => ({
	code: LETTER_CODE.test(init.key) ? `Key${init.key.toUpperCase()}` : init.key,
	shiftKey: false,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	isComposing: false,
	keyCode: 0,
	target: null,
	...init,
});

describe("transcriptKeyAction", () => {
	const keys = localKeys(null, "transcript", LOCAL_KEY_DEFAULTS.transcript);
	const key = (init: Partial<KeyboardEvent> & { key: string }) =>
		transcriptKeyAction(press(init), keys);

	test("reads ↑/↓ and j/k as reading a line, ←/→ and h/l as tree moves", () => {
		expect(key({ key: "ArrowDown" })).toEqual({ kind: "line", direction: 1 });
		expect(key({ key: "j" })).toEqual({ kind: "line", direction: 1 });
		expect(key({ key: "k" })).toEqual({ kind: "line", direction: -1 });
		expect(key({ key: "ArrowUp" })).toEqual({ kind: "line", direction: -1 });
		expect(key({ key: "h" })).toEqual({ kind: "move", key: "ArrowLeft" });
		expect(key({ key: "l" })).toEqual({ kind: "move", key: "ArrowRight" });
		expect(key({ key: "ArrowRight" })).toEqual({ kind: "move", key: "ArrowRight" });
	});

	test("goes to the ends with Home/End and g/G", () => {
		expect(key({ key: "Home" })).toEqual({ kind: "edge", direction: -1 });
		expect(key({ key: "End" })).toEqual({ kind: "edge", direction: 1 });
		expect(key({ key: "g" })).toEqual({ kind: "edge", direction: -1 });
		expect(key({ key: "G", code: "KeyG", shiftKey: true })).toEqual({ kind: "edge", direction: 1 });
	});

	test("names the page, item and exit keys", () => {
		expect(key({ key: "PageDown" })).toEqual({ kind: "page", direction: 1 });
		expect(key({ key: "PageUp" })).toEqual({ kind: "page", direction: -1 });
		expect(key({ key: " ", code: "Space" })).toEqual({ kind: "page", direction: 1 });
		expect(key({ key: " ", code: "Space", shiftKey: true })).toEqual({
			kind: "page",
			direction: -1,
		});
		expect(key({ key: "Enter" })).toEqual({ kind: "toggle" });
		expect(key({ key: "c" })).toEqual({ kind: "copy" });
		expect(key({ key: "o" })).toEqual({ kind: "open" });
		expect(key({ key: "Escape" })).toEqual({ kind: "leave" });
		expect(key({ key: "F10", shiftKey: true })).toEqual({ kind: "menu" });
		expect(key({ key: "ContextMenu" })).toEqual({ kind: "menu" });
	});

	test("Esc on the parked feed does nothing; the other keys still act", () => {
		const parked = (init: Partial<KeyboardEvent> & { key: string }) =>
			transcriptKeyAction(press(init), keys, true);
		expect(parked({ key: "Escape" })).toBeNull();
		expect(parked({ key: "ArrowDown" })).toEqual({ kind: "line", direction: 1 });
		expect(parked({ key: "j" })).toEqual({ kind: "line", direction: 1 });
	});

	test("while a question waits, Esc on the parked feed or an item goes to the question", () => {
		const waiting = (init: Partial<KeyboardEvent> & { key: string }, parked: boolean) =>
			transcriptKeyAction(press(init), keys, parked, true);
		expect(waiting({ key: "Escape" }, true)).toEqual({ kind: "question" });
		expect(waiting({ key: "Escape" }, false)).toEqual({ kind: "question" });
		expect(waiting({ key: "Escape", shiftKey: true }, false)).toBeNull();
		expect(waiting({ key: "ArrowDown" }, true)).toEqual({ kind: "line", direction: 1 });
		expect(waiting({ key: "Enter" }, false)).toEqual({ kind: "toggle" });
	});

	test("matches letters by physical key: a Russian layout's С copies and О opens", () => {
		expect(key({ key: "с", code: "KeyC" })).toEqual({ kind: "copy" });
		expect(key({ key: "щ", code: "KeyO" })).toEqual({ kind: "open" });
		expect(key({ key: "о", code: "KeyJ" })).toEqual({ kind: "line", direction: 1 });
		expect(key({ key: "c", code: "KeyX" })).toBeNull();
	});

	test("leaves modified keys and other letters alone", () => {
		expect(key({ key: "j", ctrlKey: true })).toBeNull();
		expect(key({ key: "J", shiftKey: true })).toBeNull();
		expect(key({ key: "c", metaKey: true })).toBeNull();
		expect(key({ key: "ArrowDown", altKey: true })).toBeNull();
		expect(key({ key: "F10" })).toBeNull();
		expect(key({ key: "F10", shiftKey: true, ctrlKey: true })).toBeNull();
		expect(key({ key: "x" })).toBeNull();
		expect(key({ key: "c", isComposing: true })).toBeNull();
	});

	test("a rebound copy key acts and its default no longer does", () => {
		const rebound = localKeys(
			{
				platform: "Linux x86_64",
				scopes: new Map([
					["transcript", [{ id: "transcript.copy", chord: { code: "KeyY", key: "Y" } }]],
				]),
				isTextEntry: () => false,
			},
			"transcript",
			LOCAL_KEY_DEFAULTS.transcript,
		);
		expect(transcriptKeyAction(press({ key: "y" }), rebound)).toEqual({ kind: "copy" });
		expect(transcriptKeyAction(press({ key: "c" }), rebound)).toBeNull();
		expect(transcriptKeyAction(press({ key: "j" }), rebound)).toBeNull();
		expect(transcriptKeyAction(press({ key: "ArrowDown" }), rebound)).toEqual({
			kind: "line",
			direction: 1,
		});
	});
});

describe("the composer's way into the transcript", () => {
	const enters = (platform: string, init: Partial<KeyboardEvent>) =>
		localKeys(
			{ platform, scopes: new Map(), isTextEntry: () => true },
			"composer",
			LOCAL_KEY_DEFAULTS.composer,
		).match(press({ key: "ArrowUp", ...init })) === "composer.enterTranscript";

	test("answers Ctrl+↑ off Apple and ⌘↑ on Apple only, inside the composer's text field", () => {
		expect(enters("Linux x86_64", { ctrlKey: true })).toBe(true);
		expect(enters("MacIntel", { metaKey: true })).toBe(true);
		expect(enters("MacIntel", { ctrlKey: true })).toBe(false);
		expect(enters("Linux x86_64", {})).toBe(false);
		expect(enters("Win32", { ctrlKey: true, shiftKey: true })).toBe(false);
		expect(enters("Win32", { key: "ArrowDown", ctrlKey: true })).toBe(false);
	});

	test("enters from one line, else first brings the caret to the start", () => {
		expect(composerTranscriptStep(false, false)).toBe("enter");
		expect(composerTranscriptStep(false, true)).toBe("enter");
		expect(composerTranscriptStep(true, false)).toBe("caretToStart");
		expect(composerTranscriptStep(true, true)).toBe("enter");
	});

	test("a plain Shift+Tab leaves the composer backward unless a menu or template slots hold it", () => {
		const press = (
			modifiers: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>>,
		) => ({
			key: "Tab",
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			...modifiers,
		});
		expect(composerShiftTabOut(press({ shiftKey: true }), false)).toBe(true);
		expect(composerShiftTabOut(press({ shiftKey: true }), true)).toBe(false);
		expect(composerShiftTabOut(press({}), false)).toBe(false);
		expect(composerShiftTabOut(press({ shiftKey: true, ctrlKey: true }), false)).toBe(false);
		expect(composerShiftTabOut({ ...press({ shiftKey: true }), key: "Enter" }, false)).toBe(false);
	});
});

describe("item actions", () => {
	const items = transcriptItems(rows, () => true);
	const item = (id: string) => {
		const found = items.find((candidate) => candidate.id === id);
		if (!found) throw new Error(`missing ${id}`);
		return found;
	};

	test("copies a message's source, a thought's text and a tool call's result", () => {
		expect(transcriptItemCopyText(item("u1"))).toBe("u1");
		expect(transcriptItemCopyText(item("a2"))).toBe("a2 answer");
		expect(transcriptItemCopyText(item("a1:thinking:1"))).toBe("a1:thinking:1 thought");
		expect(transcriptItemCopyText(item("t2"))).toBe("t2 output");
		expect(transcriptItemCopyText(item("activity:t4"))).toBe("t4 output");
		expect(transcriptItemCopyText(item("activity:t1"))).toBeNull();
	});

	test("has nothing to copy for a running tool or a skill card", () => {
		const running = { ...tool("t9"), tool: undefined };
		const skill = user("s1", '<skill name="x" location="/x/SKILL.md">\nbody\n</skill>');
		const [runningItem, skillItem] = transcriptItems(
			[activity("activity:t9", [running]), skill],
			() => false,
		);
		if (!runningItem || !skillItem) throw new Error("missing items");
		expect(transcriptItemCopyText(runningItem)).toBeNull();
		expect(transcriptItemCopyText(skillItem)).toBeNull();
	});

	test("opens the path of read, edit, write and single-spec tools only", () => {
		const opened = (step: RoutineToolStep) => {
			const [only] = transcriptItems([activity(`activity:${step.id}`, [step])], () => false);
			return only ? transcriptItemFilePath(only) : null;
		};
		expect(opened(tool("r", "read", { path: "src/a.ts" }))).toBe("src/a.ts");
		expect(opened(tool("w", "write", { path: "b.md" }))).toBe("b.md");
		expect(opened(tool("c", "spec_create", { path: "docs/SPEC.md" }))).toBe("docs/SPEC.md");
		expect(opened(tool("b", "bash", { command: "ls" }))).toBeNull();
		expect(opened(tool("g", "spec_grep", { pattern: "x" }))).toBeNull();
		expect(transcriptItemFilePath(item("a2"))).toBeNull();
	});

	test("skips a trailing round divider when it names the newest content", () => {
		const divider = { kind: "divider", id: "a3:divider" } as ChatRow;
		expect(newestContentRowId([...rows, divider])).toBe("a3");
		expect(newestContentRowId(rows)).toBe("a3");
		expect(newestContentRowId([])).toBeNull();
	});
});
