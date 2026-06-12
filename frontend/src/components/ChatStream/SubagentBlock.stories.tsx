import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubagentBlock } from "./SubagentBlock";
import type { ToolState } from "./ChatStream";
import type { AgentEvent } from "@/types/agent.ts";
import "./ChatStream.css";

/**
 * SubagentBlock collapses a spawned subagent's whole activity into one
 * expandable row with a summary ("3 tool calls (2 Read, 1 Grep)"). Expanding
 * renders the child tool calls inline.
 */
const CHILD_EVENTS = [
  { eventType: "toolCallStart", payload: { toolName: "Read", toolUseId: "t1", toolInput: { file_path: "tokens.css" } } },
  { eventType: "toolCallStart", payload: { toolName: "Read", toolUseId: "t2", toolInput: { file_path: "themes.css" } } },
  { eventType: "toolCallStart", payload: { toolName: "Grep", toolUseId: "t3", toolInput: { pattern: "var(--" } } },
  { eventType: "textDelta", payload: { text: "Found 52 distinct tokens across 210 uses." } },
] as unknown as AgentEvent[];

const TOOL_STATES = new Map<string, ToolState>([
  ["t1", { finished: true, output: ":root { --blue: #6AC8FF; }", isError: false }],
  ["t2", { finished: true, output: "[data-theme=dark] { --bg: #0D0D0E; }", isError: false }],
  ["t3", { finished: true, output: "210 matches", isError: false }],
]);

const meta = {
  title: "Chat/SubagentBlock",
  component: SubagentBlock,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "SubagentBlock collapses a spawned subagent's whole activity into one expandable row with a summary (e.g. \"3 tool calls (2 Read, 1 Grep)\"); expanding renders the child tool calls inline.\n\n📍 **In the app:** in the chat transcript (Sessions tab), classic view-mode, whenever a turn spawns a subagent.",
      },
    },
  },
  args: { agentType: "research", finished: true, childEvents: CHILD_EVENTS, toolStates: TOOL_STATES },
} satisfies Meta<typeof SubagentBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Finished: Story = {};
export const Running: Story = { args: { finished: false } };
