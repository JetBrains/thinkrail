import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollapsibleSection } from "./CollapsibleSection";

/**
 * CollapsibleSection is the expand/collapse container used throughout the
 * context panel. It shows a title, an optional count badge, an optional
 * collapsed-state summary, and (optionally) an "open in center" affordance.
 */
const meta = {
  title: "Primitives/CollapsibleSection",
  component: CollapsibleSection,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The expand/collapse container with a title, optional count badge, optional collapsed-state summary, and an optional \"open in center\" affordance.\n\n📍 **In the app:** the sections of the right-hand Agent Context panel — e.g. Connected/Covering Specs, Tasks, Covered Files.",
      },
    },
  },
  args: {
    title: "Connected specs",
    count: 3,
    defaultExpanded: true,
    children: (
      <ul style={{ margin: 0, paddingLeft: "var(--space-lg)", color: "var(--muted)" }}>
        <li>Agent Runner</li>
        <li>Spec Index</li>
        <li>WebSocket RPC</li>
      </ul>
    ),
  },
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {};

export const Collapsed: Story = {
  args: { defaultExpanded: false, summary: "Agent Runner, Spec Index, +1" },
};

export const WithExpandToCenter: Story = {
  args: { expandToCenter: () => {} },
};
