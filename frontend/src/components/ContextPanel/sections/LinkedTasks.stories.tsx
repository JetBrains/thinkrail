import type { Meta, StoryObj } from "@storybook/react-vite";
import { LinkedTasks } from "./LinkedTasks";
import { seedSpecContext } from "./_seed";

/**
 * LinkedTasks lists task specs that implement the selected spec (graph
 * "implements" edges), each with a status dot, sorted by status.
 */
const meta = {
  title: "Context Panel/LinkedTasks",
  component: LinkedTasks,
  beforeEach: () => { seedSpecContext(); },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "LinkedTasks lists task specs that implement the selected spec (graph \"implements\" edges), each with a status dot, sorted by status.\n\n📍 **In the app:** in the right-hand Agent Context panel (toggle Ctrl+J) when a spec is selected." } },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, background: "var(--panel)", padding: "var(--space-sm)", borderRadius: "var(--radius-md)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LinkedTasks>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
