import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompletionBanner } from "./CompletionBanner";
// CompletionBanner's `.chat-banner` styles live in the ChatStream stylesheet,
// which the parent normally provides — load it so the banner is styled.
import "./ChatStream.css";

/**
 * CompletionBanner caps a finished agent session with optional cost, turn count
 * and duration metrics.
 */
const meta = {
  title: "Chat/CompletionBanner",
  component: CompletionBanner,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "CompletionBanner caps a finished agent session with optional cost, turn count and duration metrics.\n\n📍 **In the app:** at the bottom of the chat transcript (Sessions tab) once a session finishes successfully.",
      },
    },
  },
  args: { costUsd: 0.42, turns: 7, durationMs: 95_000 },
} satisfies Meta<typeof CompletionBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithMetrics: Story = {};

export const CostOnly: Story = {
  args: { costUsd: 1.18, turns: undefined, durationMs: undefined },
};

export const NoMetrics: Story = {
  args: { costUsd: undefined, turns: undefined, durationMs: undefined },
};
