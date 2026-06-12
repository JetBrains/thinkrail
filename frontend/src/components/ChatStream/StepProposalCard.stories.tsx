import type { Meta, StoryObj } from "@storybook/react-vite";
import StepProposalCard from "./StepProposalCard";
import "./ChatStream.css";

/**
 * StepProposalCard is the orchestrator's inline proposal to start the next
 * step of a meta-ticket's plan. Pending shows the step title, skill, input
 * specs, a reason and Start Step / Dismiss… actions (Dismiss reveals an
 * optional reason textarea); answered collapses to a single click-to-expand
 * row with the decision.
 */
const meta = {
  title: "Chat/StepProposalCard",
  component: StepProposalCard,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "StepProposalCard is the orchestrator's inline proposal to start the next step of a meta-ticket's plan, with Start Step / Dismiss actions; answered collapses to a single click-to-expand row.\n\n📍 **In the app:** inline in the chat stream (Sessions tab) when the orchestrator proposes the next plan step of a meta-ticket." } },
  },
  args: {
    ticketId: "mt_4f2a",
    stepNumber: 2,
    stepTitle: "Implement the weather fetch",
    skill: "task-spec",
    inputSpecIds: ["GOAL&REQUIREMENTS.md", "DESIGN_DOC.md"],
    reason: "Step 1 (project scaffold) is done — the next step wires the public weather API call behind the CLI argument.",
    answered: false,
    onApprove: () => {},
    onDismiss: () => {},
  },
  argTypes: { onApprove: { table: { disable: true } }, onDismiss: { table: { disable: true } } },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
} satisfies Meta<typeof StepProposalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};

export const Approved: Story = {
  args: { answered: true, decision: "approved" },
};

export const Dismissed: Story = {
  args: { answered: true, decision: "dismissed", dismissReason: "Need to revise the design doc before implementing." },
};
