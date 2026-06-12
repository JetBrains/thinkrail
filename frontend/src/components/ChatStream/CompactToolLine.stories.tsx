import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompactToolLine } from "./CompactToolLine";
import "./ChatStream.css";
import "./compact.css";

/**
 * CompactToolLine is the dense one-line tool representation used in compact
 * chat mode: icon + name + summary + status. Expands to show input/output.
 */
const meta = {
  title: "Chat/CompactToolLine",
  component: CompactToolLine,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "CompactToolLine is the dense one-line tool representation used in compact chat mode: icon + name + summary + status, expandable to show input/output.\n\n📍 **In the app:** in the chat transcript (Sessions tab) with compact view-mode on, for every tool the agent calls.",
      },
    },
  },
  args: {
    toolName: "Read",
    rawInput: { file_path: "frontend/src/styles/tokens.css" },
    output: ":root { --blue: #6AC8FF; }",
    state: "success",
  },
} satisfies Meta<typeof CompactToolLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};
export const Running: Story = {
  args: { toolName: "Bash", rawInput: { command: "npm test" }, output: undefined, state: "running" },
};
export const Error: Story = {
  args: { toolName: "Bash", rawInput: { command: "npm run build" }, output: "error TS2578", isError: true, state: "error" },
};
