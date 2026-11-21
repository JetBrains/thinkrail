import { expect, test } from "bun:test";
import {
	DefaultToolRenderer,
	getToolChrome,
	getToolRenderer,
	getToolSummary,
	isDockedTool,
	isInteractiveTool,
	readComposerSuggestions,
	resolveProminence,
} from "@thinkrail/chat-ui/toolRegistry";
import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import hintMode from "@thinkrail/ext-hint-mode/web";
import nextSteps from "@thinkrail/ext-next-steps/web";
import outputs from "@thinkrail/ext-outputs/web";
import visualize, { MermaidView } from "@thinkrail/ext-visualize/web";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { EN } from "@thinkrail/locales";
import { currentTranslator } from "@thinkrail/locales/react";
import { matchKeybinding, resolveKeybindings, SHORTCUT_CATALOG } from "../keybindings";
import {
	enabledWebExtensions,
	registerWebExtensions,
	webExtensionCommands,
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
	expect(webExtensions).toEqual([visualize, askUserQuestion, hintMode, nextSteps, outputs]);
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

test("hint mode is a web-only extension: no tool renderers, a global overlay, titled copy and shortcuts", () => {
	expect(hintMode.name).toBe("hint-mode");
	expect(hintMode).not.toHaveProperty("toolRenderers");
	expect(typeof hintMode.globalOverlay).toBe("function");
	expect([hintMode.title, hintMode.description].every((key) => Object.hasOwn(EN, key))).toBe(true);
	const rows = [...hintMode.commands, ...hintMode.shortcuts];
	expect(rows.every((row) => Object.hasOwn(EN, row.title))).toBe(true);
	const catalogIds = new Set(SHORTCUT_CATALOG.map((entry) => entry.id));
	expect(rows.filter((row) => catalogIds.has(row.id))).toEqual([]);
	expect(hintMode.commands.map((command) => command.id)).toEqual(["hint-mode.show"]);
});

test("the switch decides which global contributions mount; tool renderers stay regardless", () => {
	expect(enabledWebExtensions([])).toEqual([
		visualize,
		askUserQuestion,
		hintMode,
		nextSteps,
		outputs,
	]);
	expect(enabledWebExtensions(["hint-mode", "visualize"])).toEqual([
		askUserQuestion,
		nextSteps,
		outputs,
	]);
	registerWebExtensions();
	expect(getToolRenderer("visualize")).toBe(visualize.toolRenderers.visualize.renderer);
});

test("Settings lists only the titled web extensions without tools that the server catalog lacks", () => {
	const server = new Set(["visualize", "ask-user-question", "web-access"]);
	expect(askUserQuestion.title).toBe("tools.ask.extensionTitle");
	expect(webOnlyExtensions(server).map((extension) => extension.name)).toEqual(["hint-mode"]);
	expect(webOnlyExtensions(new Set([...server, "hint-mode"]))).toEqual([]);
	expect(webOnlyExtensions(new Set()).map((extension) => extension.name)).toEqual(["hint-mode"]);
});

test("commands are listed for every extension in registry order, the switched-off ones flagged", () => {
	expect(webExtensionCommands([])).toEqual([
		{ extension: "ask-user-question", enabled: true, commands: askUserQuestion.commands },
		{ extension: "hint-mode", enabled: true, commands: hintMode.commands },
	]);
	expect(webExtensionCommands(["hint-mode"])).toEqual([
		{ extension: "ask-user-question", enabled: true, commands: askUserQuestion.commands },
		{ extension: "hint-mode", enabled: false, commands: hintMode.commands },
	]);
});

test("the question card's keys are local to the card, titled, and its locked keys are listed", () => {
	const rows = [...askUserQuestion.commands, ...askUserQuestion.shortcuts];
	expect(rows.every((row) => Object.hasOwn(EN, row.title))).toBe(true);
	expect(askUserQuestion.commands.map(({ id, scope }) => [id, scope])).toEqual([
		["ask-user-question.discuss", "ask-user-question.card"],
		["ask-user-question.interact", "ask-user-question.card"],
		["ask-user-question.compare", "ask-user-question.card"],
		["ask-user-question.submit", "ask-user-question.card"],
		["ask-user-question.skip", "ask-user-question.card"],
	]);
	const ids = rows.map(({ id }) => id);
	expect(new Set(ids).size).toBe(ids.length);
});

test("the bundled extensions' default chords conflict with nothing on any platform", () => {
	const extensions = webExtensionCommands([]);
	expect(extensions.flatMap(({ commands }) => commands).length).toBeGreaterThan(0);
	for (const platform of PLATFORMS) {
		const resolved = resolveKeybindings({ platform, extensions });
		expect([platform, resolved.conflicts]).toEqual([platform, []]);
		for (const { commands } of extensions) {
			for (const command of commands) {
				expect(resolved.byId.get(command.id)?.chords.length).toBe(command.chords.length);
			}
		}
	}
});

test("every bundled extension command is namespaced, and a scoped one reaches the resolver as local", () => {
	const extensions = webExtensionCommands([]);
	for (const platform of PLATFORMS) {
		const resolved = resolveKeybindings({ platform, extensions });
		const placed = extensions.flatMap(({ extension, commands }) =>
			commands.map((command) => {
				const scope = command.scope ?? null;
				const local = scope === null ? [] : (resolved.local.get(scope) ?? []);
				return [
					command.id.startsWith(`${extension}.`),
					resolved.byId.get(command.id)?.scope ?? null,
					scope === null || local.some(({ id }) => id === command.id),
				];
			}),
		);
		expect(placed).toEqual(
			extensions.flatMap(({ commands }) =>
				commands.map((command) => [true, command.scope ?? null, true]),
			),
		);
	}
});

test("plain F stays free in the app table and in every feature key the catalog lists", () => {
	const plainF = {
		code: "KeyF",
		key: "f",
		altKey: false,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
	};
	for (const platform of PLATFORMS) {
		expect(matchKeybinding(resolveKeybindings({ platform }), plainF, { textEntry: false })).toBe(
			null,
		);
		expect(
			matchKeybinding(
				resolveKeybindings({ platform, extensions: webExtensionCommands([]) }),
				plainF,
				{ textEntry: false },
			),
		).toBe("hint-mode.show");
	}
	const plainLetterF = SHORTCUT_CATALOG.flatMap((entry) => entry.keys ?? []).filter(
		(chord) =>
			chord.key.toLowerCase() === "f" && !chord.mod && !chord.ctrl && !chord.alt && !chord.shift,
	);
	expect(plainLetterF).toEqual([]);
});

test("suggest_next_steps registers a routine row whose result feeds the composer suggestions", () => {
	registerWebExtensions();
	const result = { details: { suggestions: ["Run the tests", "Open a PR"] } };
	expect(resolveProminence("suggest_next_steps").prominence).toBe("routine");
	expect(isInteractiveTool("suggest_next_steps")).toBe(false);
	expect(readComposerSuggestions("suggest_next_steps", {}, result)).toEqual([
		"Run the tests",
		"Open a PR",
	]);
	expect(
		getToolSummary(currentTranslator(), "suggest_next_steps", {
			...props,
			toolName: "suggest_next_steps",
			result,
		}),
	).toBe("Suggested 2 next steps");
	expect(readComposerSuggestions("suggest_next_steps", {}, result, ["next-steps"])).toBeNull();
	expect(readComposerSuggestions("visualize", {}, result)).toBeNull();
});
