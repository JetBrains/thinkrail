import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolOutputBody } from "./ToolOutputBody";
import "./ChatStream.css";

/**
 * ToolOutputBody is the content-aware renderer for tool output: it pretty-prints
 * + colorizes JSON, red-tints errors, and truncates long output with a
 * "Show all N lines" expander.
 */
const meta = {
  title: "Chat/ToolOutputBody",
  component: ToolOutputBody,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ToolOutputBody is the content-aware renderer for tool output: it pretty-prints and colorizes JSON, red-tints errors, and truncates long output with a \"Show all N lines\" expander.\n\n📍 **In the app:** inside an expanded ToolCallCard in the chat transcript (Sessions tab), showing the tool's result.",
      },
    },
  },
  args: { output: "Done. 3 files changed, 41 insertions(+), 5 deletions(-)." },
} satisfies Meta<typeof ToolOutputBody>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlainText: Story = {};

export const Json: Story = {
  args: {
    output: JSON.stringify(
      { entries: [{ path: "backend", isDir: true }, { path: "README.md", isDir: false }], count: 2, ok: true },
      null,
      0,
    ),
  },
};

export const ErrorOutput: Story = {
  args: { output: "Traceback (most recent call last):\n  File \"main.py\", line 12\n    raise ValueError(\"boom\")\nValueError: boom", isError: true },
};

export const Truncated: Story = {
  args: { output: Array.from({ length: 40 }, (_, i) => `line ${i + 1}: lorem ipsum dolor sit amet`).join("\n") },
};
