import { expect, test } from "bun:test";
import { isLayoutToolId } from "@thinkrail/contracts";
import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import board from "@thinkrail/ext-board/web";
import hintMode from "@thinkrail/ext-hint-mode/web";
import nextSteps from "@thinkrail/ext-next-steps/web";
import sessionInsights from "@thinkrail/ext-session-insights/web";
import visualize, { MermaidView } from "@thinkrail/ext-visualize/web";
import type { PanelDeclaration, ToolRenderProps, WebExtension } from "@thinkrail/extension-api/web";
import { EN } from "@thinkrail/locales";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	DefaultToolRenderer,
	getToolChrome,
	getToolRenderer,
	getToolSummary,
	isDockedTool,
	isInteractiveTool,
	readComposerSuggestions,
	resolveProminence,
} from "../chat/toolRegistry";
import { matchKeybinding, matchLocal, resolveKeybindings, SHORTCUT_CATALOG } from "../keybindings";
import { isMessageKey } from "../lib";
import {
	enabledWebExtensions,
	extensionPanels,
	extensionSideTools,
	extensionStatusItems,
	extensionViews,
	findExtensionPanel,
	findExtensionSideTool,
	findExtensionView,
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
	expect(webExtensions).toEqual([
		visualize,
		askUserQuestion,
		hintMode,
		nextSteps,
		sessionInsights,
		board,
	]);
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
		sessionInsights,
		board,
	]);
	expect(enabledWebExtensions(["hint-mode", "visualize", "board"])).toEqual([
		askUserQuestion,
		nextSteps,
		sessionInsights,
	]);
	registerWebExtensions();
	expect(getToolRenderer("visualize")).toBe(visualize.toolRenderers.visualize.renderer);
});

test("Settings lists only the titled web extensions without tools or panels that the server catalog lacks", () => {
	const server = new Set(["visualize", "ask-user-question", "web-access"]);
	expect(askUserQuestion.title).toBe("tools.ask.extensionTitle");
	expect(sessionInsights.title).toBe("sessionInsights.panel.title");
	expect(webOnlyExtensions(server).map((extension) => extension.name)).toEqual(["hint-mode"]);
	expect(webOnlyExtensions(new Set([...server, "hint-mode"]))).toEqual([]);
	expect(webOnlyExtensions(new Set()).map((extension) => extension.name)).toEqual(["hint-mode"]);
});

test("commands are listed for every extension in registry order, the switched-off ones flagged", () => {
	expect(webExtensionCommands([])).toEqual([
		{ extension: "ask-user-question", enabled: true, commands: askUserQuestion.commands },
		{ extension: "hint-mode", enabled: true, commands: hintMode.commands },
		{ extension: "session-insights", enabled: true, commands: sessionInsights.commands },
		{ extension: "board", enabled: true, commands: board.commands },
	]);
	expect(webExtensionCommands(["hint-mode"])).toEqual([
		{ extension: "ask-user-question", enabled: true, commands: askUserQuestion.commands },
		{ extension: "hint-mode", enabled: false, commands: hintMode.commands },
		{ extension: "session-insights", enabled: true, commands: sessionInsights.commands },
		{ extension: "board", enabled: true, commands: board.commands },
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

test("the session insights views' keys share one local scope, are titled, and its locked keys are listed", () => {
	const rows = [...sessionInsights.commands, ...sessionInsights.shortcuts];
	expect(rows.every((row) => Object.hasOwn(EN, row.title))).toBe(true);
	const local = sessionInsights.commands.filter(({ scope }) => scope !== undefined);
	expect(new Set(local.map(({ scope }) => scope))).toEqual(new Set(["session-insights.panel"]));
	expect(local.map(({ id }) => id)).toEqual([
		"session-insights.search",
		"session-insights.nextMatch",
		"session-insights.previousMatch",
		"session-insights.nextError",
		"session-insights.previousError",
		"session-insights.nextRetry",
		"session-insights.previousRetry",
		"session-insights.zoomToSelection",
		"session-insights.zoomIn",
		"session-insights.zoomOut",
		"session-insights.zoomFit",
	]);
	const ids = rows.map(({ id }) => id);
	expect(new Set(ids).size).toBe(ids.length);
	const chords = sessionInsights.commands.flatMap((command) => command.chords);
	expect(chords.filter((chord) => chord.code === "KeyF")).toEqual([]);
});

test("session insights opens its list from the rail with ⌃⌥I / Ctrl+Alt+I and a session's analysis for a chat", () => {
	const global = sessionInsights.commands.filter(({ scope }) => scope === undefined);
	expect(global).toEqual([
		{
			id: "session-insights.openSessions",
			title: "sessionInsights.keys.openSessions",
			chords: [{ code: "KeyI", key: "I", ctrl: true, alt: true }],
		},
	]);
	const { sessions, session, compare } = sessionInsights.panels;
	expect(sessions.rail).toEqual({ command: "session-insights.openSessions" });
	expect(sessions).not.toHaveProperty("chatAction");
	expect(session).not.toHaveProperty("rail");
	expect(compare).not.toHaveProperty("rail");
	expect(compare).not.toHaveProperty("chatAction");
	expect(session.chatAction.menuLabel).toBe("sessionInsights.session.analyze");
	expect(session.chatAction).not.toHaveProperty("label");
	expect(Object.hasOwn(EN, session.chatAction.menuLabel)).toBe(true);
	expect(
		session.chatAction.params({ projectId: "p1", workspaceId: "w1", sessionId: "s1" }),
	).toEqual({ sessionId: "s1" });
	for (const platform of PLATFORMS) {
		const resolved = resolveKeybindings({ platform, extensions: webExtensionCommands([]) });
		const press = { code: "KeyI", key: "i", altKey: true, shiftKey: false };
		expect(matchKeybinding(resolved, { ...press, ctrlKey: true, metaKey: false })).toBe(
			"session-insights.openSessions",
		);
		expect(matchKeybinding(resolved, { ...press, ctrlKey: false, metaKey: true })).toBeNull();
		const scopes = [...resolved.local.keys()];
		expect(scopes.length).toBeGreaterThan(0);
		expect(matchLocal(resolved, scopes, { ...press, ctrlKey: true, metaKey: false })).toBeNull();
	}
});

test("a panel's rail command is one of its own extension's global commands", () => {
	for (const { extension, declaration } of extensionPanels()) {
		const command = declaration.rail?.command;
		if (command === undefined) continue;
		const owner = webExtensions.find(({ name }) => name === extension);
		expect([extension, owner?.commands?.find(({ id }) => id === command)?.scope]).toEqual([
			extension,
			undefined,
		]);
		expect(owner?.commands?.some(({ id }) => id === command)).toBe(true);
	}
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

function panel(load = () => Promise.resolve({ default: () => null })): PanelDeclaration {
	return { title: "common.retry", icon: () => null, scopes: ["project"], load };
}

test("panels are read in registry and declaration order, and looked up by extension and panel", () => {
	const overview = panel();
	const detail = panel();
	const other = panel();
	const extensions: WebExtension[] = [
		{ name: "first", panels: { overview, detail } },
		{ name: "tools-only", toolRenderers: {} },
		{ name: "second", panels: { overview: other } },
	];

	expect(extensionPanels(extensions)).toEqual([
		{ extension: "first", panel: "overview", declaration: overview },
		{ extension: "first", panel: "detail", declaration: detail },
		{ extension: "second", panel: "overview", declaration: other },
	]);
	expect(findExtensionPanel("second", "overview", extensions)?.declaration).toBe(other);
	expect(findExtensionPanel("first", "missing", extensions)).toBeUndefined();
	expect(findExtensionPanel("tools-only", "overview", extensions)).toBeUndefined();
	expect(findExtensionPanel("absent", "overview", extensions)).toBeUndefined();
});

test("the bundled registry's panel list is read once, and every bundled panel has a title of this build and a scope", () => {
	expect(extensionPanels()).toBe(extensionPanels());
	for (const registered of extensionPanels()) {
		expect(findExtensionPanel(registered.extension, registered.panel)).toBe(registered);
		expect(isMessageKey(registered.declaration.title)).toBe(true);
		expect(registered.declaration.scopes.length).toBeGreaterThan(0);
	}
});

test("session insights declares its project-scoped Sessions panel, a per-session analysis panel and a two-session comparison, lazily loaded and tool-free", async () => {
	expect(sessionInsights).not.toHaveProperty("toolRenderers");
	const registered = findExtensionPanel("session-insights", "sessions");
	expect(registered?.declaration.title).toBe("sessionInsights.panel.title");
	expect(registered?.declaration.scopes).toEqual(["project"]);
	const session = findExtensionPanel("session-insights", "session");
	expect(session?.declaration.title).toBe("sessionInsights.session.title");
	expect(session?.declaration.scopes).toEqual(["session"]);
	const compare = findExtensionPanel("session-insights", "compare");
	expect(compare?.declaration.title).toBe("sessionInsights.compare.title");
	expect(compare?.declaration.scopes).toEqual(["session"]);
	expect(extensionPanels().map((panel) => `${panel.extension}/${panel.panel}`)).toEqual([
		"session-insights/sessions",
		"session-insights/session",
		"session-insights/compare",
		"board/main",
		"board/card",
		"board/initiative",
		"board/idea",
	]);
	for (const declaration of [registered?.declaration, session?.declaration, compare?.declaration]) {
		const loaded = await declaration?.load();
		expect(typeof loaded?.default).toBe("function");
	}
});

test("the board declares its view's side tools, a center and Peek panels kept off the palette, and local move keys", async () => {
	expect(extensionSideTools().map(({ id, extension, tool }) => [id, extension, tool])).toEqual([
		["ext:board:nav", "board", "nav"],
		["ext:board:activity", "board", "activity"],
	]);
	for (const id of ["ext:board:nav", "ext:board:activity"]) {
		const tool = findExtensionSideTool(id);
		expect(isMessageKey(tool?.declaration.title ?? "")).toBe(true);
		expect(typeof (await tool?.declaration.load())?.default).toBe("function");
	}
	expect(findExtensionSideTool("ext:board:board")).toBeUndefined();
	expect(findExtensionPanel("board", "main")?.declaration.scopes).toEqual(["session"]);
	expect(findExtensionPanel("board", "card")?.declaration.scopes).toEqual(["session"]);
	expect(findExtensionPanel("board", "initiative")?.declaration.scopes).toEqual(["session"]);
	const rows = [...board.commands, ...board.shortcuts];
	expect(rows.every((row) => Object.hasOwn(EN, row.title))).toBe(true);
	expect(board.commands.map(({ id, scope }) => [id, scope])).toEqual([
		["board.moveLeft", "board.cards"],
		["board.moveRight", "board.cards"],
	]);
	expect(webOnlyExtensions(new Set())).not.toContainEqual(
		expect.objectContaining({ name: "board" }),
	);
});

test("the board declares its Needs-you status item and Board view: its center panel, the nav on the left and the activity below", async () => {
	expect(extensionStatusItems().map(({ extension, item }) => [extension, item])).toEqual([
		["board", "inbox"],
	]);
	const [item] = extensionStatusItems();
	expect(typeof (await item?.declaration.load())?.default).toBe("function");
	expect(extensionViews().map(({ id }) => id)).toEqual(["board:board"]);
	const view = findExtensionView("board:board")?.declaration;
	expect(isMessageKey(view?.title ?? "")).toBe(true);
	expect(isMessageKey(view?.peekEmpty ?? "")).toBe(true);
	expect([view?.center, view?.left, view?.bottom]).toEqual(["main", "nav", "activity"]);
	expect(findExtensionPanel("board", view?.center ?? "")).toBeDefined();
	for (const tool of [view?.left, view?.bottom]) {
		expect(isLayoutToolId(`ext:board:${tool}`)).toBe(true);
		expect(findExtensionSideTool(`ext:board:${tool}`)).toBeDefined();
	}
	expect(findExtensionView("board:missing")).toBeUndefined();
	if (!view) throw new Error("Board view is not declared");
	const fake: WebExtension = { name: "fake", views: { wide: view } };
	expect(extensionViews([fake]).map(({ id }) => id)).toEqual(["fake:wide"]);
});
