import type { Meta, StoryObj } from "@storybook/react-vite";
import { CreateTicketModal } from "./CreateTicketModal";
import { useBoardStore } from "@/store/boardStore.ts";
import "./BoardView.css";

/**
 * CreateTicketModal is the "New Meta-Ticket" form shown over the board: a
 * title input, a type Dropdown (Feature / Bug / Idea / Improvement), an
 * optional description, and Cancel / Create actions. Create is disabled until
 * a title is entered. Submitting calls `boardStore.createTicket`; here it is
 * stubbed to a no-op so the modal can be exercised without a backend.
 */
const meta = {
  title: "Board/CreateTicketModal",
  component: CreateTicketModal,
  beforeEach: () => {
    useBoardStore.setState({
      createTicket: (async () => {}) as never,
    });
  },
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "CreateTicketModal is the \"New Meta-Ticket\" form shown over the board: a title input, a type Dropdown, an optional description, and Cancel / Create actions.\n\n📍 **In the app:** the modal opened by the \"+ New\" button on the Tickets board." } },
  },
  args: { open: true, onClose: () => {} },
  argTypes: { onClose: { table: { disable: true } } },
} satisfies Meta<typeof CreateTicketModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
