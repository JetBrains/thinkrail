import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageHistory } from "./MessageHistory";
import { useMessageHistoryStore } from "@/store/messageHistoryStore";
import "./ChatStream.css";

/**
 * MessageHistory is the filterable recent-prompts picker (↑/↓ to navigate, Enter
 * to pick). It's a popover that opens *upward* from the message input
 * (`position: absolute; bottom: 100%`), so the story anchors it above a mock
 * input box near the bottom of the canvas. Reads the message-history store, so
 * the story seeds a few prompts.
 */
const meta = {
  title: "Chat/MessageHistory",
  component: MessageHistory,
  beforeEach: () => {
    useMessageHistoryStore.setState({
      history: [
        "Add stories for the remaining shared selector components.",
        "Pay attention to the fonts in all component storybooks.",
        "Spacing and Radii should be a doc too.",
        "Extract a shared Button from the ad-hoc buttons.",
        "Why are docs not scrollable?",
      ],
    });
  },
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "MessageHistory is the filterable recent-prompts picker (↑/↓ to navigate, Enter to pick) that opens upward from the message input.\n\n📍 **In the app:** a popover above the chat message input (Sessions tab) when you press ↑ in an empty input." } },
  },
  args: { onSelect: () => {}, onClose: () => {} },
  argTypes: { onSelect: { table: { disable: true } }, onClose: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: 320, padding: "var(--space-md)" }}>
        {/* Anchor near the bottom; the history popover opens upward from here. */}
        <div style={{ position: "absolute", left: "var(--space-md)", right: "var(--space-md)", bottom: "var(--space-md)" }}>
          <Story />
          <div
            style={{
              border: "1px solid var(--border2)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-sm) var(--space-md)",
              color: "var(--muted)",
              font: "var(--font-sm) var(--font)",
            }}
          >
            Message input ↑ (history opens above)
          </div>
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof MessageHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
