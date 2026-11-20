import {
	RiCompass3Line,
	RiFlag2Line,
	RiKanbanView2,
	RiLightbulbLine,
	RiPulseLine,
	RiStickyNoteLine,
} from "@remixicon/react";
import { defineWebExtension } from "@thinkrail/extension-api/web";
import { BOARD_SHORTCUTS, CARD_COMMANDS } from "./keys";

export default defineWebExtension({
	name: "board",
	title: "board.title",
	views: {
		board: {
			title: "board.boardView.title",
			icon: RiKanbanView2,
			center: "main",
			left: "nav",
			bottom: "activity",
			layout: { leftWidth: 0.16, bottomHeight: 0.26 },
			peekEmpty: "board.boardView.peekEmpty",
		},
	},
	sideTools: {
		nav: {
			title: "board.nav.title",
			icon: RiCompass3Line,
			defaultSide: "left",
			load: () => import("./BoardNav"),
		},
		activity: {
			title: "board.feed.region",
			icon: RiPulseLine,
			defaultSide: "left",
			load: () => import("./BoardActivity"),
		},
	},
	panels: {
		main: {
			title: "board.boardView.title",
			icon: RiKanbanView2,
			scopes: ["session"],
			load: () => import("./BoardMain"),
		},
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
	containerSections: {
		initiative: { load: () => import("./ContainerAutopilot") },
	},
	commands: CARD_COMMANDS,
	shortcuts: BOARD_SHORTCUTS,
});
