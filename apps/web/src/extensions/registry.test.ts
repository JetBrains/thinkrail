import { expect, test } from "bun:test";
import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import hintMode from "@thinkrail/ext-hint-mode/web";
import visualize, { MermaidView } from "@thinkrail/ext-visualize/web";
import type { ExtensionShortcutKey, ToolRenderProps } from "@thinkrail/extension-api/web";
import { EN } from "@thinkrail/locales";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	DefaultToolRenderer,
	getToolChrome,
	getToolRenderer,
	getToolSummary,
	isDockedTool,
	isInteractiveTool,
	resolveProminence,
} from "../chat/toolRegistry";
import { matchKeybinding, SHORTCUT_CATALOG } from "../keybindings";
import {
	enabledWebExtensions,
	registerWebExtensions,
	webExtensions,
	webOnlyExtensions,
} from "./index";

const props: ToolRenderProps = {
	toolCallId: "diagram-1",
	toolName: "visualize",
	args: {},
	result: null,
	status: "done",
	streaming: false,
};

test("the ordered web registry composes the public visualize descriptor without replacing fallback", () => {
	expect(webExtensions).toEqual([visualize, askUserQuestion, hintMode]);
	expect(typeof MermaidView).toBe("function");
	for (let i = 0; i < 2; i++) {
		registerWebExtensions();
		expect(getToolRenderer("visualize")).toBe(visualize.toolRenderers.visualize.renderer);
		expect(resolveProminence("visualize")).toEqual({
			prominence: "primary",
			defaultExpanded: true,
		});
		expect(getToolChrome("visualize")).toBe("card");
		expect(getToolRenderer("unregistered-extension-tool")).toBe(DefaultToolRenderer);
	}
});

test("visualize summaries preserve titles and diagram/comparison fallbacks", () => {
	registerWebExtensions();
	for (const [args, summary] of [
		[{}, "diagram"],
		[{ type: "diagram", title: "Architecture" }, "Architecture"],
		[{ type: "comparison" }, "comparison — 0 options"],
		[{ type: "comparison", options: [{ name: "One" }] }, "comparison — 1 option"],
		[{ type: "comparison", options: [{ name: "One" }, { name: "Two" }] }, "comparison — 2 options"],
		[{ type: "comparison", title: "Trade-offs" }, "Trade-offs"],
	] as const) {
		expect(getToolSummary(currentTranslator(), "visualize", { ...props, args })).toBe(summary);
	}
});

test("the ask_user_question card registers bare, interactive and docked from its extension — the one the plan page resolves by name", () => {
	registerWebExtensions();
	const registration = askUserQuestion.toolRenderers.ask_user_question;
	expect(typeof registration.renderer).toBe("function");
	expect(registration.options).toEqual({ chrome: "bare", interactive: true, dock: true });
	expect(getToolRenderer("ask_user_question")).toBe(registration.renderer);
	expect(getToolChrome("ask_user_question")).toBe("bare");
	expect(isInteractiveTool("ask_user_question")).toBe(true);
	expect(isDockedTool("ask_user_question")).toBe(true);
	// Interactivity is opt-in per registration: the other extension tool and unknown names are not.
	expect(isInteractiveTool("visualize")).toBe(false);
	expect(isInteractiveTool("unregistered-extension-tool")).toBe(false);
});

const PLATFORMS = ["MacIntel", "Linux x86_64", "Win32"];

function chordEvent(chord: ExtensionShortcutKey, platform: string) {
	const apple = platform === "MacIntel";
	return {
		code: chord.code,
		key: chord.key,
		altKey: chord.alt === true,
		shiftKey: chord.shift === true,
		ctrlKey: chord.ctrl === true || (chord.mod === true && !apple),
		metaKey: chord.mod === true && apple,
	};
}

test("hint mode is a web-only extension: no tool renderers, a global overlay, titled copy and shortcuts", () => {
	expect(hintMode.name).toBe("hint-mode");
	expect(hintMode).not.toHaveProperty("toolRenderers");
	expect(typeof hintMode.globalOverlay).toBe("function");
	expect([hintMode.title, hintMode.description].every((key) => Object.hasOwn(EN, key))).toBe(true);
	expect(hintMode.shortcuts.every((row) => Object.hasOwn(EN, row.title))).toBe(true);
	const catalogIds = new Set(SHORTCUT_CATALOG.map((entry) => entry.id));
	expect(hintMode.shortcuts.filter((row) => catalogIds.has(row.id))).toEqual([]);
});

test("the switch decides which global contributions mount; tool renderers stay regardless", () => {
	expect(enabledWebExtensions([])).toEqual([visualize, askUserQuestion, hintMode]);
	expect(enabledWebExtensions(["hint-mode", "visualize"])).toEqual([askUserQuestion]);
	registerWebExtensions();
	expect(getToolRenderer("visualize")).toBe(visualize.toolRenderers.visualize.renderer);
});

test("Settings lists only the titled web extensions the server catalog lacks", () => {
	const server = new Set(["visualize", "ask-user-question", "web-access"]);
	expect(webOnlyExtensions(server).map((extension) => extension.name)).toEqual(["hint-mode"]);
	expect(webOnlyExtensions(new Set([...server, "hint-mode"]))).toEqual([]);
	expect(webOnlyExtensions(new Set()).map((extension) => extension.name)).toEqual(["hint-mode"]);
});

test("no extension chord collides with the app-wide keybinding table on any platform", () => {
	const chords = webExtensions.flatMap(({ shortcuts = [] }) =>
		shortcuts.flatMap((row) => row.keys),
	);
	expect(chords.length).toBeGreaterThan(0);
	for (const platform of PLATFORMS) {
		for (const chord of chords) {
			expect([chord.code, matchKeybinding(chordEvent(chord, platform), platform)]).toEqual([
				chord.code,
				null,
			]);
		}
	}
});

test("plain F is bound by neither the keybinding table nor any feature key the catalog lists", () => {
	for (const platform of PLATFORMS) {
		const plainF = {
			code: "KeyF",
			key: "f",
			altKey: false,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
		};
		expect(matchKeybinding(plainF, platform)).toBeNull();
	}
	const plainLetterF = SHORTCUT_CATALOG.flatMap((entry) => entry.keys ?? []).filter(
		(chord) =>
			chord.key.toLowerCase() === "f" && !chord.mod && !chord.ctrl && !chord.alt && !chord.shift,
	);
	expect(plainLetterF).toEqual([]);
});
