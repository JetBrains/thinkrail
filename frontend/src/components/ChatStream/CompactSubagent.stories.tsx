import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompactSubagent } from "./CompactSubagent";
import type { ToolState } from "./ChatStream";
import type { AgentEvent } from "@/types/agent.ts";
import "./ChatStream.css";
import "./compact.css";

/**
 * CompactSubagent is the compact-mode collapsed representation of a spawned
 * subagent: a one-line row with a tool count, expandable to its tool lines.
 */
const CHILD_EVENTS = [
  { eventType: "toolCallStart", payload: { toolName: "Read", toolUseId: "t1", toolInput: { file_path: "tokens.css" } } },
  { eventType: "toolCallStart", payload: { toolName: "Grep", toolUseId: "t2", toolInput: { pattern: "var(--" } } },
] as unknown as AgentEvent[];

const TOOL_STATES = new Map<string, ToolState>([
  ["t1", { finished: true, output: ":root {}", isError: false }],
  ["t2", { finished: true, output: "210 matches", isError: false }],
]);

const meta = {
  title: "Chat/CompactSubagent",
  component: CompactSubagent,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "CompactSubagent is the compact-mode collapsed representation of a spawned subagent: a one-line row with a tool count, expandable to its tool lines.\n\n📍 **In the app:** in the chat transcript (Sessions tab) with compact view-mode on, whenever a turn spawns a subagent.",
      },
    },
  },
  args: { agentType: "research", finished: true, childEvents: CHILD_EVENTS, toolStates: TOOL_STATES },
} satisfies Meta<typeof CompactSubagent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Finished: Story = {};
export const Running: Story = { args: { finished: false } };
