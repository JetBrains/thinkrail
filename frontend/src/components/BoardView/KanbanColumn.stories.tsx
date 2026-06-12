import type { Meta, StoryObj } from "@storybook/react-vite";
import { DragDropProvider } from "@dnd-kit/react";
import { KanbanColumn } from "./KanbanColumn";
import { MetaTicketCard } from "./MetaTicketCard";
import type { MetaTicketSummary } from "@/types/board.ts";
import "./BoardView.css";

/**
 * KanbanColumn is a droppable board column with a header, count badge, and an
 * empty state. Shown here populated with MetaTicketCards and empty.
 */
function ticket(id: string, title: string, type: MetaTicketSummary["type"]): MetaTicketSummary {
  return {
    id, title, type, status: "idea",
    planPath: null, orchestratorSessionId: null, linkedSpecIds: [], sessionIds: [], order: 0, created: "", updated: "",
  };
}

const TICKETS = [
  ticket("t1", "Extract a shared Button", "improvement"),
  ticket("t2", "Per-project theme presets", "idea"),
];

const meta = {
  title: "Board/KanbanColumn",
  component: KanbanColumn,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "KanbanColumn is a droppable board column with a header, count badge, and an empty state, holding the cards for one status.\n\n📍 **In the app:** each status column (Idea, Described, ... Done) on the Tickets board's Kanban view." } },
  },
  decorators: [
    (Story) => (
      <DragDropProvider>
        <div style={{ width: 300 }}>
          <Story />
        </div>
      </DragDropProvider>
    ),
  ],
  // children defaulted here (required prop); each story supplies real children via render.
  args: { id: "idea", title: "Ideas", count: 2, children: null },
} satisfies Meta<typeof KanbanColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTickets: Story = {
  render: (args) => (
    <KanbanColumn {...args}>
      {TICKETS.map((t, i) => (
        <MetaTicketCard key={t.id} ticket={t} index={i} column="idea" onOpen={() => {}} />
      ))}
    </KanbanColumn>
  ),
};

export const Empty: Story = {
  args: { title: "Done", count: 0 },
  render: (args) => <KanbanColumn {...args}>{null}</KanbanColumn>,
};
