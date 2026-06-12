import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PanelTabs, type PanelTabItem } from "./PanelTabs";
import "../AppShell/AppShell.css";

/**
 * PanelTabs is the left-panel tab bar (text-only): Specs / Files / Progress.
 */
type Tab = "specs" | "files" | "progress";
const TABS: PanelTabItem<Tab>[] = [
  { id: "specs", label: "Specs" },
  { id: "files", label: "Files" },
  { id: "progress", label: "Progress" },
];

const meta = {
  title: "Primitives/PanelTabs",
  component: PanelTabs<Tab>,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The text-only tab bar for switching left-panel contents.\n\n📍 **In the app:** the Specs / Files / Progress tab bar at the top of the left panel.",
      },
    },
  },
  args: { tabs: TABS, active: "specs", onChange: () => {} },
  decorators: [(Story) => <div style={{ width: 280 }}><Story /></div>],
} satisfies Meta<typeof PanelTabs<Tab>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function PanelTabsStory() {
    const [active, setActive] = useState<Tab>("specs");
    return <PanelTabs tabs={TABS} active={active} onChange={setActive} />;
  },
};
