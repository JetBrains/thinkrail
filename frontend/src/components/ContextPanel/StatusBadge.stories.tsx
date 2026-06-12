import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./utils";

/**
 * StatusBadge is a small pill that colors itself from its `status` string via
 * a data-status attribute (styled in utils.css). Used across the spec tree,
 * context panel and board. These are the statuses utils.css styles.
 */
const meta = {
  title: "Primitives/StatusBadge",
  component: StatusBadge,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A small pill that colors itself from its `status` string via a `data-status` attribute (styled in `utils.css`).\n\n📍 **In the app:** used across the spec tree, the Agent Context panel (e.g. `SpecHealth`) and the Tickets board to show item status.",
      },
    },
  },
  args: { status: "active" },
  argTypes: {
    status: { control: "select", options: ["active", "draft", "done", "blocked", "stale"] },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = { args: { status: "active" } };
export const Draft: Story = { args: { status: "draft" } };
export const Done: Story = { args: { status: "done" } };
export const Blocked: Story = { args: { status: "blocked" } };
export const Stale: Story = { args: { status: "stale" } };

export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
      {["active", "draft", "done", "blocked", "stale"].map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};
