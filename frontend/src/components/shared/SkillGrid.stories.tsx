import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SkillGrid } from "./SkillGrid";
import { FALLBACK_SKILLS } from "@/constants/skills";
import { useSettingsStore } from "@/store/settingsStore.ts";

/**
 * SkillGrid shows the available spec-driven skills grouped by category and lets
 * the user pick one. It reads the skill list from the settings store, so the
 * story seeds it with the app's real FALLBACK_SKILLS.
 *
 * Skills that require a ticket render greyed-out unless `context.hasTicket` is
 * true — both states are shown below.
 */
const meta = {
  title: "Pickers/SkillGrid",
  component: SkillGrid,
  beforeEach: () => {
    useSettingsStore.setState({ skills: FALLBACK_SKILLS });
  },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "SkillGrid shows the available spec-driven skills grouped by category and lets the user pick one; skills that require a ticket render greyed-out unless `context.hasTicket` is true.\n\n📍 **In the app:** in the draft session config card's Skill picker popover (`DraftConfigCard`)." } },
  },
  args: { selectedId: null, onSelect: () => {} },
} satisfies Meta<typeof SkillGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

function SkillGridDemo({ hasTicket }: { hasTicket: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <SkillGrid selectedId={selectedId} onSelect={setSelectedId} context={{ hasTicket }} />;
}

export const NoTicket: Story = {
  render: () => <SkillGridDemo hasTicket={false} />,
};

export const WithTicketContext: Story = {
  render: () => <SkillGridDemo hasTicket={true} />,
};
