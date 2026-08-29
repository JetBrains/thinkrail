import { registerToolRenderer } from "../../toolRegistry";
import { AgentCard } from "./AgentCard";
import { agentOutcome, agentSummary } from "./runDetails";

registerToolRenderer("Agent", AgentCard, {
	summary: agentSummary,
	outcome: agentOutcome,
	prominence: "primary",
});
registerToolRenderer("get_subagent_result", AgentCard, {
	summary: agentSummary,
	outcome: agentOutcome,
});
