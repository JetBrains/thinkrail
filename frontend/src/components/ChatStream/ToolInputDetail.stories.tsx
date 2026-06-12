import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolInputDetail } from "./ToolInputDetail";
import "./ChatStream.css";

/**
 * ToolInputDetail renders a tool's input object as labeled key→value pairs with
 * type-aware coloring (strings, numbers, booleans, nested JSON). Long strings
 * truncate with a "show full" toggle; keys starting with `_` are hidden.
 */
const meta = {
  title: "Chat/ToolInputDetail",
  component: ToolInputDetail,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ToolInputDetail renders a tool's input object as labeled key→value pairs with type-aware coloring; long strings truncate with a \"show full\" toggle and `_`-prefixed keys are hidden.\n\n📍 **In the app:** inside an expanded ToolCallCard in the chat transcript (Sessions tab), showing the tool's arguments.",
      },
    },
  },
  args: {
    input: {
      file_path: "frontend/src/components/ui/Button.tsx",
      limit: 100,
      show_hidden: false,
      _internal: "hidden — starts with underscore",
    },
  },
} satisfies Meta<typeof ToolInputDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};

export const Nested: Story = {
  args: {
    input: {
      command: "npm test",
      env: { CI: true, NODE_ENV: "test" },
      args: ["--run", "--reporter=dot"],
    },
  },
};

export const LongString: Story = {
  args: {
    input: {
      content: "export function Button() { return <button className=\"btn\" />; } ".repeat(8),
    },
  },
};
