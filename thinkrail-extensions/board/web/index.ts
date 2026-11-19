import { RiFlag2Line, RiKanbanView2, RiLightbulbLine, RiStickyNoteLine } from "@remixicon/react";
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
		initiative: {
			title: "board.roadmap.panelTitle",
			icon: RiFlag2Line,
			scopes: ["session"],
			load: () => import("./InitiativePanel"),
		},
		idea: {
			title: "board.discovery.panelTitle",
			icon: RiLightbulbLine,
			scopes: ["session"],
			load: () => import("./IdeaPanel"),
		},
	},
	statusItems: {
		inbox: { load: () => import("./InboxStatus") },
	},
	layoutPresets: {
		board: {
			title: "board.mode.title",
			icon: RiKanbanView2,
			left: {
				visible: true,
				width: 0.6,
				groups: [
					{ id: "board-mode-projects", weight: 0.1, folded: true, tools: ["projects"] },
					{ id: "board-mode-board", weight: 0.9, folded: false, tools: ["ext:board:board"] },
				],
			},
			right: { visible: false, width: 0.28, groups: [] },
		},
	},
	commands: CARD_COMMANDS,
	shortcuts: BOARD_SHORTCUTS,
});
