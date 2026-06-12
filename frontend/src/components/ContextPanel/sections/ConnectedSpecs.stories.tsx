import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConnectedSpecs } from "./ConnectedSpecs";
import { seedSpecContext } from "./_seed";

/**
 * ConnectedSpecs lists the selected spec's graph neighbors grouped by relation
 * (Parent / Implemented by / References …), with an "open in center" affordance
 * that launches the graph modal.
 */
const meta = {
  title: "Context Panel/ConnectedSpecs",
  component: ConnectedSpecs,
  beforeEach: () => { seedSpecContext(); },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "ConnectedSpecs lists the selected spec's graph neighbors grouped by relation (Parent / Implemented by / References …), with an \"open in center\" affordance that launches the graph modal.\n\n📍 **In the app:** in the right-hand Agent Context panel (toggle Ctrl+J) when a spec is selected." } },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, background: "var(--panel)", padding: "var(--space-sm)", borderRadius: "var(--radius-md)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectedSpecs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
