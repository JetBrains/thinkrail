import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoardCardContextMenu } from "./BoardCardContextMenu";
import type { TicketSummary } from "@/types/board.ts";
import "./BoardView.css";

/**
 * BoardCardContextMenu is the right-click menu on a kanban card: Open, the valid
 * status transitions for the current status, the other ticket types, and a
 * danger Delete. Positioned at the click coords.
 */
const ticket: TicketSummary = {
  id: "t1",
  title: "Extract a shared Button",
  lifecycle: "design",
  type: "feature",
  productDesignPath: null,
  technicalDesignPath: null,
  historyPath: null,
  implementationPlanPath: null,
  orchestrator: null,
  linkedSpecIds: [],
  sessionIds: [],
  order: 0,
  created: "",
  updated: "",
  rev: 0,
};

const meta = {
  title: "Board/BoardCardContextMenu",
  component: BoardCardContextMenu,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "BoardCardContextMenu is the right-click menu on a kanban card: Open, valid status transitions, other ticket types, and a danger Delete, positioned at the click coords.\n\n📍 **In the app:** the menu that appears when you right-click a meta-ticket card on the Tickets board." } },
  },
  args: { ticket, x: 16, y: 16, onClose: () => {}, onOpen: () => {}, onUpdateTicket: () => {}, onDeleteTicket: () => {} },
  argTypes: {
    onClose: { table: { disable: true } },
    onOpen: { table: { disable: true } },
    onUpdateTicket: { table: { disable: true } },
    onDeleteTicket: { table: { disable: true } },
  },
  decorators: [(Story) => <div style={{ position: "relative", height: 360 }}><Story /></div>],
} satisfies Meta<typeof BoardCardContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
