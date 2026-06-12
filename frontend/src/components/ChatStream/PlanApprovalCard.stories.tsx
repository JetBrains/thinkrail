import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlanApprovalCard } from "./PlanApprovalCard";
import "./ChatStream.css";

/**
 * PlanApprovalCard presents an agent's proposed plan (rendered markdown) with
 * Approve / Reject. Rejecting opens an inline reason field. Answered state
 * collapses to a single row with the decision.
 */
const PLAN = `# Extract a shared Button component

1. Audit the 221 ad-hoc buttons and group by variant
2. Build a token-based \`Button\` (primary / secondary / danger / ghost)
3. Migrate the first batch of call sites
4. Verify visually identical with Playwright`;

const meta = {
  title: "Chat/PlanApprovalCard",
  component: PlanApprovalCard,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "PlanApprovalCard presents an agent's proposed plan (rendered markdown) with Approve / Reject; rejecting opens an inline reason field.\n\n📍 **In the app:** inline in the chat stream (Sessions tab) when the agent finishes planning (ExitPlanMode)." } },
  },
  args: {
    planContent: PLAN,
    allowedPrompts: [{ tool: "Bash", prompt: "npm test" }],
    answered: false,
    onApprove: () => {},
    onDeny: () => {},
  },
  argTypes: { onApprove: { table: { disable: true } }, onDeny: { table: { disable: true } } },
} satisfies Meta<typeof PlanApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};
export const Approved: Story = { args: { answered: true, decision: "approve" } };
export const Rejected: Story = {
  args: { answered: true, decision: "deny", rejectionReason: "Cover the icon-button variant too." },
};
