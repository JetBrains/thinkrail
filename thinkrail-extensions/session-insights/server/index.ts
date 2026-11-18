import { defineServerExtension } from "@thinkrail/extension-api/server";
import { SESSION_INSIGHTS_API_VERSION } from "@thinkrail/pi-session-insights/core";
import { sessionInsightsQueries } from "./queries";

export {
	BACKGROUND_COMPLETION_MESSAGE,
	FAILED_RUN_STATUSES,
	SUBAGENT_COMPLETION_MESSAGE,
	SUBAGENT_RESULT_TOOL,
	SUBAGENT_SPAWN_TOOL,
	SUBAGENT_TOOLS,
	SUBAGENT_USAGE_KIND,
	type SubagentRunRecord,
	TODO_STATUSES,
	TODO_TEXT_GROUP,
	TODO_TEXT_ITEM,
	TODO_TOOLS,
	type TodoGroupRecord,
	type TodoPlanRecord,
	type TodoRecord,
	UNFINISHED_RUN_STATUSES,
	WAKE_DELIVERY,
} from "@thinkrail/pi-session-insights/core";

export default defineServerExtension({
	name: "session-insights",
	title: "Session insights",
	description:
		"A local breakdown of your past pi sessions per project: tokens, cost, tool calls, errors, subagents and outcomes, with where every number comes from. Computed on this machine; nothing leaves it.",
	extensions: [],
	// The panel covers the package's vanilla `/insights` command, which would read ThinkRail sessions
	// with vanilla locators (no ThinkRail delegation folders); a user's npm install of it stays out.
	supersedesPackages: ["@thinkrail/pi-session-insights"],
	apiVersion: SESSION_INSIGHTS_API_VERSION,
	queries: sessionInsightsQueries,
});
