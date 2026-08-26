// Registers the subagent tool renderers (capability: the `pi-subagents` extension, joined by tool
// name). `Agent` is PRIMARY — a delegated run never folds into an activity group — and stays a stock
// collapsed ToolCard whose header summary is the live line (role · counters · current step, re-derived
// from each REPLACE partialResult snapshot; the Claude Code row convention — see SPEC.md).
// `get_subagent_result` shares the body/summary (same details shape) but stays routine: collecting a
// result is plumbing, not the run itself.

import { registerToolRenderer } from "../../toolRegistry";
import { AgentCard } from "./AgentCard";
import { agentSummary } from "./runDetails";

registerToolRenderer("Agent", AgentCard, { summary: agentSummary, prominence: "primary" });
registerToolRenderer("get_subagent_result", AgentCard, { summary: agentSummary });
