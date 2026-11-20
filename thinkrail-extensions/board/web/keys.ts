import type { ExtensionCommand, ExtensionShortcut } from "@thinkrail/extension-api/web";

export const CARDS_SCOPE = "board.cards";

export const CARD_KEYS = {
	moveLeft: "board.moveLeft",
	moveRight: "board.moveRight",
} as const;

export const CARD_COMMANDS: readonly ExtensionCommand[] = [
	{
		id: CARD_KEYS.moveLeft,
		title: "board.keys.moveLeft",
		scope: CARDS_SCOPE,
		chords: [{ code: "ArrowLeft", key: "←", alt: true }],
	},
	{
		id: CARD_KEYS.moveRight,
		title: "board.keys.moveRight",
		scope: CARDS_SCOPE,
		chords: [{ code: "ArrowRight", key: "→", alt: true }],
	},
];

export const BOARD_SHORTCUTS: readonly ExtensionShortcut[] = [
	{ id: "board.open", title: "board.keys.open", keys: [{ code: "Enter", key: "Enter" }] },
];
