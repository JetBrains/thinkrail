import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { TicketSelector } from "./TicketSelector";
import { useBoardStore } from "@/store/boardStore.ts";
import type { MetaTicketSummary } from "@/types/board.ts";

/**
 * TicketSelector is a searchable list of meta-tickets, each showing its status
 * and type. It reads tickets from the board store (a Map), so the story seeds
 * it with a few mock tickets spanning different statuses.
 */
function ticket(
  id: string,
  title: string,
  status: MetaTicketSummary["status"],
  type: MetaTicketSummary["type"],
  order: number,
): MetaTicketSummary {
  return {
    id,
    title,
    status,
    type,
    planPath: null,
    orchestratorSessionId: null,
    linkedSpecIds: [],
    sessionIds: [],
    order,
    created: "",
    updated: "",
  };
}

const MOCK_TICKETS: MetaTicketSummary[] = [
  ticket("t1", "Add Storybook design system", "executing", "feature", 0),
  ticket("t2", "Fix dropdown overflow on narrow viewports", "described", "bug", 1),
  ticket("t3", "Extract a shared Button component", "idea", "improvement", 2),
  ticket("t4", "Dark light-theme is an unimplemented stub", "specified", "bug", 3),
  ticket("t5", "Per-project theme presets", "planned", "idea", 4),
];

const meta = {
  title: "Pickers/TicketSelector",
  component: TicketSelector,
  beforeEach: () => {
    useBoardStore.setState({ tickets: new Map(MOCK_TICKETS.map((t) => [t.id, t])) });
  },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "TicketSelector is a searchable list of meta-tickets, each showing its status and type, read from the board store.\n\n📍 **In the app:** in the draft session config card's \"+ attach to ticket\" popover (`DraftConfigCard`)." } },
  },
  args: { selectedId: null, onSelect: () => {} },
} satisfies Meta<typeof TicketSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

function TicketSelectorDemo() {
  const [selectedId, setSelectedId] = useState<string | null>("t1");
  return (
    <div style={{ maxWidth: 420 }}>
      <TicketSelector selectedId={selectedId} onSelect={setSelectedId} />
    </div>
  );
}

export const Default: Story = {
  render: () => <TicketSelectorDemo />,
};
