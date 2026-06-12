import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResizeHandle } from "./ResizeHandle";

/**
 * ResizeHandle is the thin draggable divider between layout panels. Drag it to
 * resize (turns blue on hover); dragging below the collapse threshold collapses
 * the panel. Shown here between two mock panels — drag the divider.
 */
const meta = {
  title: "Primitives/ResizeHandle",
  component: ResizeHandle,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The thin draggable divider between layout panels — drag to resize (turns blue on hover); dragging below the collapse threshold collapses the panel.\n\n📍 **In the app:** the dividers between the left panel / center / right Context panel. Rendered by `AppShell`.",
      },
    },
  },
  args: { side: "left", panelWidth: 240, min: 160, max: 480, collapseThreshold: 120, onResize: () => {}, onCollapse: () => {} },
  argTypes: { onResize: { table: { disable: true } }, onCollapse: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", height: 240, color: "var(--text)" }}>
        <div style={{ width: 200, padding: "var(--space-md)", background: "var(--panel)" }}>Left panel</div>
        <Story />
        <div style={{ flex: 1, padding: "var(--space-md)" }}>Main content</div>
      </div>
    ),
  ],
} satisfies Meta<typeof ResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
