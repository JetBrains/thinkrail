import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorBanner } from "./ErrorBanner";
import "./ChatStream.css";

/**
 * ErrorBanner caps a failed agent session. The special "context_overflow"
 * subtype shows Retry / Start-fresh actions; otherwise it lists the errors.
 */
const meta = {
  title: "Chat/ErrorBanner",
  component: ErrorBanner,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ErrorBanner caps a failed agent session. The special \"context_overflow\" subtype shows Retry / Start-fresh actions; otherwise it lists the errors.\n\n📍 **In the app:** at the bottom of the chat transcript (Sessions tab) when a session ends in error.",
      },
    },
  },
  args: { errors: ["Tool 'Bash' exited with code 1", "Connection reset by peer"] },
} satisfies Meta<typeof ErrorBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GenericError: Story = {};
export const ContextOverflow: Story = {
  args: { errors: undefined, subtype: "context_overflow", bonsaiSid: "sess-123" },
};
