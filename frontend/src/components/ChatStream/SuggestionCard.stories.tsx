import type { Meta, StoryObj } from "@storybook/react-vite";
import SuggestionCard from "./SuggestionCard";
import "./ChatStream.css";

/**
 * SuggestionCard is the inline card the agent shows when it proposes starting
 * a new (sub)session for a skill — e.g. "/architecture-design". Pending shows
 * the skill, linked specs, reason, an optional collapsible Instructions prompt
 * and Start / Stay / Dismiss actions; answered collapses to a single
 * click-to-expand row with the decision.
 */
const meta = {
  title: "Chat/SuggestionCard",
  component: SuggestionCard,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "SuggestionCard is the inline card the agent shows when it proposes starting a new (sub)session for a skill, with Start / Stay / Dismiss actions; answered collapses to a single click-to-expand row.\n\n📍 **In the app:** inline in the chat stream (Sessions tab) when the agent suggests running a skill session." } },
  },
  args: {
    skill: "architecture-design",
    specIds: ["GOAL&REQUIREMENTS.md"],
    name: "Sketch the architecture",
    reason: "The goal doc is settled — a short design pass will define the stack and modules before any tickets run.",
    answered: false,
    onApprove: () => {},
    onDismiss: () => {},
  },
  argTypes: { onApprove: { table: { disable: true } }, onDismiss: { table: { disable: true } } },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
} satisfies Meta<typeof SuggestionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};

export const WithPrompt: Story = {
  args: {
    prompt: "Run /architecture-design for the weather CLI. Keep it to a single-file Python script — no framework, no persistence.",
  },
};

export const Approved: Story = {
  args: { answered: true, decision: "approved" },
};

export const Dismissed: Story = {
  args: { answered: true, decision: "dismissed", dismissReason: "Too early — let's flesh out requirements first." },
};
