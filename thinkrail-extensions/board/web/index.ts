import { RiKanbanView2, RiStickyNoteLine } from "@remixicon/react";
import { defineWebExtension } from "@thinkrail/extension-api/web";
import { BOARD_SHORTCUTS, CARD_COMMANDS } from "./keys";

export default defineWebExtension({
	name: "board",
	title: "board.title",
	sideTools: {
		board: {
			title: "board.tool.title",
			icon: RiKanbanView2,
			defaultSide: "left",
			load: () => import("./BoardTool"),
		},
	},
	panels: {
		card: {
			title: "board.card.panelTitle",
			icon: RiStickyNoteLine,
			scopes: ["session"],
			load: () => import("./CardPanel"),
		},
	},
	commands: CARD_COMMANDS,
	shortcuts: BOARD_SHORTCUTS,
});
