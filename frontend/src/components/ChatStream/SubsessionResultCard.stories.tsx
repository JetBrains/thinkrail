import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubsessionResultCard } from "./SubsessionResultCard";
import "./ChatStream.css";

/**
 * SubsessionResultCard summarizes what a child subsession returned to its
 * parent, labelled by type (discussion 💬 / refinement ✏️).
 */
const meta = {
  title: "Chat/SubsessionResultCard",
  component: SubsessionResultCard,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "SubsessionResultCard summarizes what a child subsession returned to its parent, labelled by type (discussion 💬 / refinement ✏️).\n\n📍 **In the app:** inline in the parent session's chat stream (Sessions tab) after a child subsession returns its result." } },
  },
  args: {
    childName: "design discussion",
    subsessionType: "discussion",
    summary: "Agreed to extract a Button with primary/secondary/danger/ghost variants and migrate the wizard first.",
  },
} satisfies Meta<typeof SubsessionResultCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Discussion: Story = {};
export const Refinement: Story = {
  args: {
    childName: "ticket refinement",
    subsessionType: "refinement",
    summary: "Rewrote the ticket description with acceptance criteria and three edge cases.",
  },
};
