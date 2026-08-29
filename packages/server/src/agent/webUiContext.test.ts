import { expect, test } from "bun:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail/contracts";
import {
	cancelExtUiForSession,
	createWebUiContext,
	notifyExtensionError,
	resolveExtUi,
	setExtUiPublisher,
} from "./webUiContext";

const ESC = "\u001b";

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

test("theme: pi's Theme contract is implemented and every method yields plain text", () => {
	const { theme } = createWebUiContext("sess-theme");

	expect(theme).toBeInstanceOf(Theme);
	for (const name of Object.getOwnPropertyNames(Theme.prototype)) {
		if (name === "constructor") continue;
		expect(typeof Reflect.get(theme, name)).toBe("function");
	}

	expect(theme.fg("accent", "Theme works")).toBe("Theme works");
	expect(theme.bg("selectedBg", "Theme works")).toBe("Theme works");
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
