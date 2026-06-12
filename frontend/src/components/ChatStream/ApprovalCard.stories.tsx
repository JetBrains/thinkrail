import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApprovalCard } from "./ApprovalCard";
import "./ChatStream.css";

/**
 * ApprovalCard is the permission prompt shown when the agent wants to run a
 * tool that needs approval. Pending = full card with Approve/Deny; answered =
 * compact single line (click to expand) showing the decision.
 */
const meta = {
  title: "Chat/ApprovalCard",
  component: ApprovalCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ApprovalCard is the permission prompt shown when the agent wants to run a tool that needs approval. Pending shows a full card with Approve/Deny; once answered it collapses to a compact one-line summary.\n\n📍 **In the app:** inline in the chat stream (Sessions tab) whenever the agent requests tool approval mid-turn.",
      },
    },
  },
  args: {
    toolName: "Bash",
    toolInput: { command: "rm -rf build/" },
    description: "Remove the build output directory before rebuilding.",
    answered: false,
    onApprove: () => {},
    onDeny: () => {},
  },
  argTypes: { onApprove: { table: { disable: true } }, onDeny: { table: { disable: true } } },
} satisfies Meta<typeof ApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};
export const Approved: Story = { args: { answered: true, decision: "approve" } };
export const Denied: Story = { args: { answered: true, decision: "deny" } };
export const Interrupted: Story = { args: { answered: true, interrupted: true } };
