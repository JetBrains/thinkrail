import { RiArrowLeftRightLine, RiBarChartBoxLine, RiFlowChart } from "@remixicon/react";
import { defineWebExtension } from "@thinkrail/extension-api/web";
import { OPEN_SESSIONS, OPEN_SESSIONS_COMMAND, PANEL_COMMANDS, PANEL_SHORTCUTS } from "./keys";

export default defineWebExtension({
	name: "session-insights",
	title: "sessionInsights.panel.title",
	panels: {
		sessions: {
			title: "sessionInsights.panel.title",
			keywords: "sessionInsights.panel.keywords",
			icon: RiBarChartBoxLine,
			scopes: ["project"],
			rail: { command: OPEN_SESSIONS },
			wide: true,
			load: () => import("./SessionsPanel"),
		},
		session: {
			title: "sessionInsights.session.title",
			icon: RiFlowChart,
			scopes: ["session"],
			chatAction: {
				menuLabel: "sessionInsights.session.analyze",
				params: ({ sessionId }) => ({ sessionId }),
			},
			chatPane: true,
			wide: true,
			load: () => import("./session/SessionPanel"),
		},
		compare: {
			title: "sessionInsights.compare.title",
			icon: RiArrowLeftRightLine,
			scopes: ["session"],
			wide: true,
			load: () => import("./compare/ComparePanel"),
		},
	},
	commands: [OPEN_SESSIONS_COMMAND, ...PANEL_COMMANDS],
	shortcuts: PANEL_SHORTCUTS,
});
