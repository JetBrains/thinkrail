// pi protocol types, re-exported TYPE-ONLY from the pi-ai / pi-agent-core roots. `verbatimModuleSyntax`
// erases these at build, so the web bundle never pulls pi runtime. Never value-import a pi package here,
// never import `@earendil-works/pi-coding-agent` (node:fs), and never touch the pi-ai provider subpaths
// (`/providers/*`, `/api/*`, …) — they pull the Node SDKs.

export type { AgentEvent, AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
export type {
	AssistantMessage,
	AssistantMessageEvent,
	ImageContent,
	Message,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "@earendil-works/pi-ai";

import type { AgentEvent } from "@earendil-works/pi-agent-core";

// The unified render union the UI switches on. The real superset (`AgentSessionEvent`) is declared in the
// Node-only `pi-coding-agent`, so it's mirrored here rather than imported. Finalized at M10/M11 (chat),
// where the session-event members (compaction_*, auto_retry_*, extension_*) get added; until then it's
// the agent event union.
export type PiEvent = AgentEvent;
