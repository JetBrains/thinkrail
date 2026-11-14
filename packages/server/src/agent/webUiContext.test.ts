import { expect, test } from "bun:test";
import { type ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail/contracts";
import {
	cancelExtUiForSession,
	createWebUiContext,
	notifyExtensionError,
	notifyExtUi,
	pendingExtUiDialog,
	resolveExtUi,
	selectForToolCall,
	setExtUiPublisher,
} from "./webUiContext";

const ESC = "\u001b";

test("extension editor calls address their own chat's composer and keep paste apart from replace", () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	try {
		const first = createWebUiContext("editor-a");
		const second = createWebUiContext("editor-b");
		first.setEditorText("Draft 中文\nnext line");
		second.pasteToEditor("Pasted draft");
		first.setEditorText("");
		expect(frames).toEqual([
			{
				id: expect.any(String),
				sessionId: "editor-a",
				kind: "setEditorText",
				text: "Draft 中文\nnext line",
			},
			{
				id: expect.any(String),
				sessionId: "editor-b",
				kind: "pasteToEditor",
				text: "Pasted draft",
			},
			{ id: expect.any(String), sessionId: "editor-a", kind: "setEditorText", text: "" },
		]);
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("an extension status coloured with raw escapes reaches the page as plain text", () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	try {
		createWebUiContext("sess-status").setStatus(
			"demo",
			`${ESC}[38;5;208mcaveman${ESC}[0m level: FULL`,
		);
		expect(frames).toEqual([
			{
				id: expect.any(String),
				sessionId: "sess-status",
				kind: "setStatus",
				key: "demo",
				text: "caveman level: FULL",
			},
		]);
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("every text an extension pushes to the page loses its escapes, and a cleared status stays cleared", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	const red = (text: string) => `${ESC}[31m${text}${ESC}[39m`;
	const ui = createWebUiContext("sess-plain");
	try {
		ui.notify(red("Saved"), "warning");
		ui.setStatus("demo", undefined);
		ui.setWidget("demo", [red("first"), `${ESC}]8;;https://example.com${ESC}\\second`]);
		ui.setTitle(red("Chat title"));
		ui.pasteToEditor(red("pasted"));
		ui.setEditorText(red("replaced"));
		const dialogs = [
			ui.confirm(red("Proceed?"), red("Apply it?")),
			ui.input(red("Name?"), red("placeholder")),
			ui.editor(red("Edit"), red("prefill")),
			ui.select(red("Pick"), [red("one"), "two"]),
		];
		expect(pendingExtUiDialog("sess-plain")).toMatchObject({
			kind: "confirm",
			title: "Proceed?",
			message: "Apply it?",
		});
		cancelExtUiForSession("sess-plain");
		await Promise.all(dialogs);

		expect(frames.filter((frame) => frame.kind !== "dismiss")).toEqual([
			{
				id: expect.any(String),
				sessionId: "sess-plain",
				kind: "notify",
				message: "Saved",
				level: "warning",
			},
			{
				id: expect.any(String),
				sessionId: "sess-plain",
				kind: "setStatus",
				key: "demo",
				text: null,
			},
			{
				id: expect.any(String),
				sessionId: "sess-plain",
				kind: "setWidget",
				key: "demo",
				content: ["first", "second"],
			},
			{ id: expect.any(String), sessionId: "sess-plain", kind: "setTitle", title: "Chat title" },
			{ id: expect.any(String), sessionId: "sess-plain", kind: "pasteToEditor", text: "pasted" },
			{ id: expect.any(String), sessionId: "sess-plain", kind: "setEditorText", text: "replaced" },
			{
				id: expect.any(String),
				sessionId: "sess-plain",
				kind: "confirm",
				title: "Proceed?",
				message: "Apply it?",
			},
			{
				id: expect.any(String),
				sessionId: "sess-plain",
				kind: "input",
				title: "Name?",
				placeholder: "placeholder",
			},
			{
				id: expect.any(String),
				sessionId: "sess-plain",
				kind: "editor",
				title: "Edit",
				prefill: "prefill",
			},
			{
				id: expect.any(String),
				sessionId: "sess-plain",
				kind: "select",
				title: "Pick",
				options: ["one", "two"],
			},
		]);
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("a select answer gives the extension back its own option, escapes included", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	const coloured = `${ESC}[32mAllow${ESC}[39m`;
	try {
		const answer = createWebUiContext("sess-select").select("Run it?", [coloured, "Deny"]);
		const frame = frames.at(-1);
		if (frame?.kind !== "select") throw new Error("expected a select frame");
		expect(frame.options).toEqual(["Allow", "Deny"]);
		resolveExtUi({ id: frame.id, value: "Allow" });
		expect(await answer).toBe(coloured);
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("a select answer is the clicked option even if the extension changes its list meanwhile", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	const ui = createWebUiContext("sess-live");
	try {
		const cases: [(list: string[]) => unknown, string][] = [
			[(list) => list.shift(), "test"],
			[(list) => list.reverse(), "build"],
		];
		for (const [change, clicked] of cases) {
			const tasks = ["build", "test", "deploy"];
			const answer = ui.select("Run which task?", tasks);
			change(tasks);
			resolveExtUi({ id: frames.at(-1)?.id ?? "", value: clicked });
			expect(await answer).toBe(clicked);
		}
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("select reads its options by index, like pi, not through the array's iterator", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	const ui = createWebUiContext("sess-iter");
	const iterators: (() => Iterator<string>)[] = [
		() => {
			throw new Error("iterator boom");
		},
		() => ["other", "items"][Symbol.iterator](),
	];
	try {
		for (const iterator of iterators) {
			const options = ["build", `${ESC}[32mtest${ESC}[39m`];
			Object.defineProperty(options, Symbol.iterator, { value: iterator });
			const answer = ui.select("Pick", options);
			const frame = frames.at(-1);
			expect(frame).toMatchObject({ kind: "select", options: ["build", "test"] });
			resolveExtUi({ id: frame?.id ?? "", value: "test" });
			expect(await answer).toBe(options[1]);
		}
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("values that are not strings, from an untyped extension, still reach the page", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	const ui = createWebUiContext("sess-untyped") as unknown as Record<
		keyof ExtensionUIContext,
		(...args: unknown[]) => unknown
	>;
	try {
		ui.setWidget("demo", ["a", undefined, null]);
		ui.setTitle(undefined);
		ui.setEditorText(undefined);
		const confirmed = ui.confirm("Delete it?");
		resolveExtUi({ id: frames.at(-1)?.id ?? "", value: true });
		expect(await confirmed).toBe(true);
		const selected = ui.select(undefined, ["a", null]);
		resolveExtUi({ id: frames.at(-1)?.id ?? "", value: "a" });
		expect(await selected).toBe("a");
		for (const options of [undefined, "one", {}]) {
			const picked = ui.select("Pick", options);
			resolveExtUi({ id: frames.at(-1)?.id ?? "", value: "one" });
			expect(await picked).toBe("one");
		}

		expect(frames).toEqual<unknown[]>([
			{
				id: expect.any(String),
				sessionId: "sess-untyped",
				kind: "setWidget",
				key: "demo",
				content: ["a", undefined, null],
			},
			{ id: expect.any(String), sessionId: "sess-untyped", kind: "setTitle", title: undefined },
			{ id: expect.any(String), sessionId: "sess-untyped", kind: "setEditorText", text: undefined },
			{ id: expect.any(String), sessionId: "sess-untyped", kind: "confirm", title: "Delete it?" },
			{
				id: expect.any(String),
				sessionId: "sess-untyped",
				kind: "select",
				title: undefined,
				options: ["a", null],
			},
			{ id: expect.any(String), sessionId: "sess-untyped", kind: "select", title: "Pick" },
			{
				id: expect.any(String),
				sessionId: "sess-untyped",
				kind: "select",
				title: "Pick",
				options: "one",
			},
			{
				id: expect.any(String),
				sessionId: "sess-untyped",
				kind: "select",
				title: "Pick",
				options: {},
			},
		]);
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("extension-UI bridge: confirm round-trips, a cancel resolves undefined, dispose dismisses", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((f) => frames.push(f));
	const lastFrame = (): ExtUiRequest => {
		const f = frames.at(-1);
		if (!f) throw new Error("expected an ext-ui frame to have been pushed");
		return f;
	};
	const ui = createWebUiContext("sess-extui");

	const confirmP = ui.confirm("Proceed?", "Apply the change?");
	const confirmFrame = lastFrame();
	expect(confirmFrame.kind).toBe("confirm");
	expect(confirmFrame.sessionId).toBe("sess-extui");
	resolveExtUi({ id: confirmFrame.id, value: true });
	expect(await confirmP).toBe(true);

	const selectP = ui.select("Pick one", ["a", "b"]);
	resolveExtUi({ id: lastFrame().id, value: null });
	expect(await selectP).toBeUndefined();

	const inputP = ui.input("Name?");
	const inputFrame = lastFrame();
	cancelExtUiForSession("sess-extui");
	expect(await inputP).toBeUndefined();
	expect(frames.some((f) => f.kind === "dismiss" && f.id === inputFrame.id)).toBe(true);

	setExtUiPublisher(() => {});
});

test("extension-UI bridge: a dialog names the running tool call it is about, if any", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((f) => frames.push(f));
	let running: string | undefined = "call-7";
	const ui = createWebUiContext("sess-anchor", () => running);

	const anchored = ui.confirm("Run rm?", "It deletes files.");
	expect(frames.at(-1)).toMatchObject({ kind: "confirm", toolCallId: "call-7" });
	running = undefined;
	const loose = ui.input("Paste the code");
	expect(frames.at(-1)).not.toHaveProperty("toolCallId");
	const explicit = selectForToolCall(
		"sess-anchor",
		{ toolCallId: "call-9", toolInput: { path: "/etc/hosts" } },
		"Allow?",
		["Deny", "Allow once"],
	);
	expect(frames.at(-1)).toMatchObject({
		kind: "select",
		toolCallId: "call-9",
		toolInput: { path: "/etc/hosts" },
	});
	resolveExtUi({ id: frames.at(-1)?.id ?? "", value: "Allow once" });
	expect(await explicit).toBe("Allow once");

	cancelExtUiForSession("sess-anchor");
	expect(await anchored).toBe(false);
	expect(await loose).toBeUndefined();
	setExtUiPublisher(() => {});
});

test("a tool guard title built from an extension's tool name reaches the page as plain text", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	try {
		const answer = selectForToolCall(
			"sess-guard",
			{ toolCallId: "call-1", toolInput: {} },
			`Allow ev${ESC}[31mil${ESC}[0m/write?`,
			["Deny", "Allow once"],
		);
		const plain = { kind: "select", title: "Allow evil/write?", options: ["Deny", "Allow once"] };
		expect(frames.at(-1)).toMatchObject(plain);
		expect(pendingExtUiDialog("sess-guard")).toMatchObject(plain);
		cancelExtUiForSession("sess-guard");
		expect(await answer).toBeUndefined();
	} finally {
		setExtUiPublisher(() => {});
	}
});

test("theme: pi's Theme contract is implemented and every method yields plain text", () => {
	const { theme } = createWebUiContext("sess-theme");

	expect(theme).toBeInstanceOf(Theme);
	for (const name of Object.getOwnPropertyNames(Theme.prototype)) {
		if (name === "constructor") continue;
		if (Object.getOwnPropertyDescriptor(Theme.prototype, name)?.get) continue;
		expect(typeof Reflect.get(theme, name)).toBe("function");
	}

	expect(theme.fg("accent", "Theme works")).toBe("Theme works");
	expect(theme.bg("selectedBg", "Theme works")).toBe("Theme works");
	expect(theme.style("Theme works", { fg: "accent", bg: "selectedBg", bold: true })).toBe(
		"Theme works",
	);
	for (const decorate of [
		theme.bold,
		theme.italic,
		theme.underline,
		theme.inverse,
		theme.strikethrough,
	]) {
		expect(decorate.call(theme, "Theme works")).toBe("Theme works");
	}
	expect(theme.getFgAnsi("accent")).toBe("");
	expect(theme.getBgAnsi("selectedBg")).toBe("");
});

test("theme: the methods inherited from pi stay plain text too", () => {
	const { theme } = createWebUiContext("sess-theme-inherited");

	expect(theme.getThinkingBorderColor("high")("Theme works")).toBe("Theme works");
	expect(theme.getBashModeBorderColor()("Theme works")).toBe("Theme works");
});

test("theme: nothing the theme renders carries terminal escapes", () => {
	const { theme } = createWebUiContext("sess-theme-ansi");

	const rendered = [
		theme.fg("accent", "x"),
		theme.bg("selectedBg", "x"),
		theme.style("x", { fg: { kind: "rgb", r: 255, g: 0, b: 0 }, italic: true }),
		theme.bold("x"),
		theme.italic("x"),
		theme.underline("x"),
		theme.inverse("x"),
		theme.strikethrough("x"),
		theme.getFgAnsi("accent"),
		theme.getBgAnsi("selectedBg"),
		theme.getThinkingBorderColor("high")("x"),
		theme.getBashModeBorderColor()("x"),
	];
	for (const out of rendered) expect(out).not.toContain(ESC);
});

test("no member of the context is left undefined", () => {
	const ui = createWebUiContext("sess-members");

	for (const [key, value] of Object.entries(ui)) {
		expect(value).toBeDefined();
		if (key !== "theme") expect(typeof value).toBe("function");
	}
});

test("an extension error reaches the client with the extension, the event and the cause", () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((f) => frames.push(f));

	notifyExtensionError("sess-err", {
		extensionPath: "/home/u/.pi/agent/extensions/theme-probe.ts",
		event: "session_start",
		error: "theme.fg is not a function",
		stack: "unused",
	});

	expect(frames.at(-1)).toMatchObject({
		sessionId: "sess-err",
		kind: "notify",
		level: "error",
		message: "Extension theme-probe.ts failed on session_start: theme.fg is not a function",
	});

	setExtUiPublisher(() => {});
});

test("a host notice that quotes a coloured error reaches the client as plain text", () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((f) => frames.push(f));

	notifyExtUi("sess-err", `Could not reload: ${ESC}[31mlevel is not set${ESC}[39m`, "error");

	expect(frames.at(-1)).toMatchObject({
		kind: "notify",
		message: "Could not reload: level is not set",
	});

	setExtUiPublisher(() => {});
});

test("a long coloured cause is cut after its escapes are gone, so the cap counts visible text", () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((f) => frames.push(f));

	notifyExtensionError("sess-err", {
		extensionPath: "/home/u/.pi/agent/extensions/caveman.ts",
		event: "session_start",
		error: `${"a".repeat(497)}${ESC}[31m${"r".repeat(100)}${ESC}[39m`,
	});

	expect(frames.at(-1)).toMatchObject({
		kind: "notify",
		message: `Extension caveman.ts failed on session_start: ${"a".repeat(497)}rrr…`,
	});

	notifyExtensionError("sess-err", {
		extensionPath: "/home/u/.pi/agent/extensions/caveman.ts",
		event: "session_start",
		error: `${ESC}[31m${"b".repeat(498)}${ESC}[39m`,
	});

	expect(frames.at(-1)).toMatchObject({
		kind: "notify",
		message: `Extension caveman.ts failed on session_start: ${"b".repeat(498)}`,
	});

	setExtUiPublisher(() => {});
});

test("an extension error is bounded and named by its directory when the file is anonymous", () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((f) => frames.push(f));

	notifyExtensionError("sess-err", {
		extensionPath: "/home/u/.pi/agent/extensions/branch-status/SKILL.md",
		event: "turn_start",
		error: "x".repeat(5_000),
	});

	const frame = frames.at(-1);
	if (frame?.kind !== "notify") throw new Error("expected a notify frame");
	expect(frame.message.startsWith("Extension branch-status failed on turn_start: ")).toBe(true);
	expect(frame.message.length).toBeLessThan(600);
	expect(frame.message.endsWith("…")).toBe(true);

	setExtUiPublisher(() => {});
});
