import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolCallCard } from "./ToolCallCard";
import "./ChatStream.css";

/**
 * ToolCallCard renders a single agent tool invocation with an icon, summary
 * header and a colored left border by state (running = blue, success = green,
 * error = red). Click the header (when not running) to expand input + output.
 */
const meta = {
  title: "Chat/ToolCallCard",
  component: ToolCallCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ToolCallCard renders a single agent tool invocation with an icon, summary header and a colored left border by state (running = blue, success = green, error = red). Click the header to expand input + output.\n\n📍 **In the app:** in the chat transcript (Sessions tab), classic view-mode, for every tool the agent calls.",
      },
    },
  },
  args: {
    toolName: "Read",
    rawInput: { file_path: "frontend/src/styles/tokens.css" },
    output: "1  :root {\n2    --blue: #6AC8FF;\n3    --green: #6AD859;\n4  }",
    state: "success",
  },
} satisfies Meta<typeof ToolCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};
export const Running: Story = {
  args: { toolName: "Bash", rawInput: { command: "npm test" }, output: undefined, state: "running" },
};
export const Error: Story = {
  args: {
    toolName: "Bash",
    rawInput: { command: "npm run build" },
    output: "error TS2578: Unused '@ts-expect-error' directive.",
    isError: true,
    state: "error",
  },
};
