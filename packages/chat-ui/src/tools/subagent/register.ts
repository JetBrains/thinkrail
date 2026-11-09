import { registerToolRenderer } from "../../toolRegistry";
import { AgentCard } from "./AgentCard";
import { agentSummary } from "./runDetails";

registerToolRenderer("Agent", AgentCard, { summary: agentSummary, prominence: "primary" });
registerToolRenderer("get_subagent_result", AgentCard, { summary: agentSummary });
