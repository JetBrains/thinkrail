import type { Meta, StoryObj } from "@storybook/react-vite";
import { AssistantMessage } from "./AssistantMessage";
import "./ChatStream.css";

/**
 * AssistantMessage is a Bonsai (assistant) chat bubble: avatar + name + a
 * markdown-rendered body, with an optional streaming cursor.
 */
const meta = {
  title: "Chat/AssistantMessage",
  component: AssistantMessage,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "AssistantMessage is a Bonsai (assistant) chat bubble: avatar + name + a markdown-rendered body, with an optional streaming cursor.\n\n📍 **In the app:** in the chat transcript (Sessions tab) for every assistant turn — the cursor shows while text is still streaming in.",
      },
    },
  },
  args: {
    text: "Here's the plan:\n\n1. Extract a shared `Button`\n2. Migrate the wizard screens\n\nSound good?",
  },
} satisfies Meta<typeof AssistantMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Streaming: Story = { args: { text: "Working on it", streaming: true } };
