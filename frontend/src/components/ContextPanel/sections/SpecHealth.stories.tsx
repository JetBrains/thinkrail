import type { Meta, StoryObj } from "@storybook/react-vite";
import { SpecHealth } from "./SpecHealth";
import { seedSpecContext } from "./_seed";

/**
 * SpecHealth summarizes the selected spec's status, dates, coverage count and
 * type. Reads the selected spec from the store (seeded with "Agent Runner").
 */
const meta = {
  title: "Context Panel/SpecHealth",
  component: SpecHealth,
  beforeEach: () => { seedSpecContext(); },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "SpecHealth summarizes the selected spec's status, dates, coverage count and type.\n\n📍 **In the app:** in the right-hand Agent Context panel (toggle Ctrl+J) when a spec is selected." } },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, background: "var(--panel)", padding: "var(--space-sm)", borderRadius: "var(--radius-md)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpecHealth>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
