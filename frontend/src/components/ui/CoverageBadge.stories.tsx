import type { Meta, StoryObj } from "@storybook/react-vite";
import { CoverageBadge } from "./CoverageBadge";
import "../SpecTree/SpecTree.css";

/**
 * CoverageBadge is the task-coverage pill from the spec tree: icon + done/total,
 * colored by completion state.
 */
const meta = {
  title: "Primitives/CoverageBadge",
  component: CoverageBadge,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The task-coverage pill: an icon plus done/total, colored by completion state.\n\n📍 **In the app:** on spec nodes in the Specs tab's left-panel spec tree. Rendered by `SpecTree`.",
      },
    },
  },
  args: { done: 5, total: 5 },
} satisfies Meta<typeof CoverageBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllDone: Story = { args: { done: 5, total: 5 } };
export const InProgress: Story = { args: { done: 3, total: 5 } };
export const None: Story = { args: { done: 0, total: 8 } };
export const Expanded: Story = { args: { done: 1, total: 2, expanded: true } };

export const AllStates: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
      <CoverageBadge done={5} total={5} />
      <CoverageBadge done={3} total={5} />
      <CoverageBadge done={0} total={8} />
      <CoverageBadge done={1} total={2} expanded />
    </div>
  ),
};
