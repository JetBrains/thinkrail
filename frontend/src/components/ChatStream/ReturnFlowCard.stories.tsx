import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReturnFlowCard } from "./ReturnFlowCard";
import "./ChatStream.css";

/**
 * ReturnFlowCard appears when a subsession proposes content to hand back to its
 * parent. "discussion" → Approve & return; "refinement" → put in input / send
 * as message. Both support inline Edit and Revise.
 */
const meta = {
  title: "Chat/ReturnFlowCard",
  component: ReturnFlowCard,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "ReturnFlowCard appears when a subsession proposes content to hand back to its parent — \"discussion\" offers Approve & return, \"refinement\" offers put-in-input / send-as-message, both with inline Edit and Revise.\n\n📍 **In the app:** inline in the chat stream (Sessions tab) of a subsession when it's ready to return to its parent." } },
  },
  args: {
    thinkrailSid: "sess-123",
    subsessionType: "discussion",
    proposedSummary:
      "We agreed to extract a shared Button with primary/secondary/danger/ghost variants and migrate the wizard screens first.",
    onApprove: () => {},
    onDismiss: () => {},
    onRevise: () => {},
  },
  argTypes: {
    onApprove: { table: { disable: true } },
    onDismiss: { table: { disable: true } },
    onRevise: { table: { disable: true } },
    onPutInInput: { table: { disable: true } },
    onSendAsMessage: { table: { disable: true } },
  },
} satisfies Meta<typeof ReturnFlowCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Discussion: Story = {};

export const Refinement: Story = {
  args: {
    subsessionType: "refinement",
    proposedSummary: "Refined ticket description with acceptance criteria and edge cases.",
    onPutInInput: () => {},
    onSendAsMessage: () => {},
  },
};
