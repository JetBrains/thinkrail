import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompactUserMessage } from "./CompactUserMessage";
import "./ChatStream.css";
import "./compact.css";

/**
 * CompactUserMessage is the user's line in compact chat mode — a "You" labelled
 * bubble that clamps long text and expands on click.
 */
const meta = {
  title: "Chat/CompactUserMessage",
  component: CompactUserMessage,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "CompactUserMessage is the user's line in compact chat mode — a \"You\"-labelled bubble that clamps long text and expands on click.\n\n📍 **In the app:** in the chat transcript (Sessions tab) with compact view-mode on, for every message you send.",
      },
    },
  },
  args: { text: "Add stories for the remaining shared selector components." },
} satisfies Meta<typeof CompactUserMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const LongText: Story = {
  args: {
    text: "Pay attention to the fonts in all component storybooks please — it looks like the default browser font though in the real app I believe we use something different for the default font. Also the docs page doesn't scroll.",
  },
};
