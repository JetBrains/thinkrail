import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MessageSquareText, ListChecks, BookOpenText, FolderOpen } from "lucide-react";
import { NavTabs, type NavTabItem } from "./NavTabs";
import "../AppShell/AppShell.css";

/**
 * NavTabs is the header navigation (icon + label), e.g. the workspace's
 * Sessions / Tickets / Specs / Files tabs.
 */
type View = "sessions" | "board" | "specs" | "files";
const TABS: NavTabItem<View>[] = [
  { id: "sessions", icon: <MessageSquareText size={16} strokeWidth={1.5} />, label: "Sessions" },
  { id: "board", icon: <ListChecks size={16} strokeWidth={1.5} />, label: "Tickets" },
  { id: "specs", icon: <BookOpenText size={16} strokeWidth={1.5} />, label: "Specs" },
  { id: "files", icon: <FolderOpen size={16} strokeWidth={1.5} />, label: "Files" },
];

const meta = {
  title: "Primitives/NavTabs",
  component: NavTabs<View>,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The header navigation (icon + label) for switching top-level views.\n\n📍 **In the app:** the Sessions / Tickets / Specs / Files tabs in the app `Header`.",
      },
    },
  },
  args: { tabs: TABS },
  decorators: [(Story) => <div className="header-bar" style={{ justifyContent: "center" }}><Story /></div>],
} satisfies Meta<typeof NavTabs<View>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function NavTabsStory() {
    const [active, setActive] = useState<View>("sessions");
    return <NavTabs tabs={TABS} active={active} onSelect={setActive} />;
  },
};
