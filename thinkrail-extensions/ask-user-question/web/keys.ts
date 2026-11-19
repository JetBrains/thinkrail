import type { ExtensionCommand, ExtensionShortcut } from "@thinkrail/extension-api/web";

export const CARD_SCOPE = "ask-user-question.card";

export const CARD_KEYS = {
	discuss: "ask-user-question.discuss",
	interact: "ask-user-question.interact",
	compare: "ask-user-question.compare",
	submit: "ask-user-question.submit",
	skip: "ask-user-question.skip",
} as const;

const command = (
	id: string,
	title: ExtensionCommand["title"],
	...chords: ExtensionCommand["chords"]
): ExtensionCommand => ({ id, title, scope: CARD_SCOPE, chords });

export const CARD_COMMANDS: readonly ExtensionCommand[] = [
	command(CARD_KEYS.discuss, "tools.ask.keys.discuss", { code: "KeyD", key: "D" }),
	command(CARD_KEYS.interact, "tools.ask.keys.interact", { code: "KeyI", key: "I" }),
	command(CARD_KEYS.compare, "tools.ask.keys.compare", { code: "KeyC", key: "C" }),
	command(
		CARD_KEYS.submit,
		"tools.ask.keys.submit",
		{ code: "Enter", key: "↵", mod: true },
		{ code: "NumpadEnter", key: "Num ↵", mod: true },
	),
	command(CARD_KEYS.skip, "tools.ask.keys.skip", { code: "Escape", key: "Esc", shift: true }),
];

const UP = { code: "ArrowUp", key: "ArrowUp" } as const;
const DOWN = { code: "ArrowDown", key: "ArrowDown" } as const;
const LEFT = { code: "ArrowLeft", key: "ArrowLeft" } as const;
const RIGHT = { code: "ArrowRight", key: "ArrowRight" } as const;
const ENTER = { code: "Enter", key: "Enter" } as const;
const ESCAPE = { code: "Escape", key: "Escape" } as const;

export const CARD_SHORTCUTS: readonly ExtensionShortcut[] = [
	{ id: "ask-user-question.move", title: "tools.ask.keys.move", keys: [UP, DOWN] },
	{
		id: "ask-user-question.edges",
		title: "tools.ask.keys.edges",
		keys: [
			{ code: "Home", key: "Home" },
			{ code: "End", key: "End" },
		],
	},
	{ id: "ask-user-question.select", title: "tools.ask.keys.select", keys: [ENTER] },
	{
		id: "ask-user-question.note",
		title: "tools.ask.keys.note",
		keys: [{ code: "Space", key: " " }],
	},
	{ id: "ask-user-question.questions", title: "tools.ask.keys.questions", keys: [LEFT, RIGHT] },
	{
		id: "ask-user-question.scrollPreview",
		title: "tools.ask.keys.scrollPreview",
		keys: [
			{ code: "PageUp", key: "PageUp" },
			{ code: "PageDown", key: "PageDown" },
		],
	},
	{ id: "ask-user-question.toComposer", title: "tools.ask.keys.toComposer", keys: [ESCAPE] },
	{ id: "ask-user-question.closeField", title: "tools.ask.keys.closeField", keys: [ENTER, ESCAPE] },
	{
		id: "ask-user-question.compareOverlay",
		title: "tools.ask.keys.compareOverlay",
		keys: [LEFT, RIGHT, { code: "Digit1", key: "1–9" }, ENTER, ESCAPE],
	},
];
