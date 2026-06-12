import type { Meta, StoryObj } from "@storybook/react-vite";
import { TicketSection } from "./TicketSection";
import "./MetaTicketDetail.css";

/**
 * TicketSection is a labeled section in the ticket detail panel: a header
 * (optionally clickable, with an optional badge) above its content. Used for
 * Description, Specifications, Spec Diffs, Plan and Sessions in TicketInfo.
 */
const meta = {
  title: "Ticket/TicketSection",
  component: TicketSection,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "TicketSection is a labeled section in the ticket detail panel: a header (optionally clickable, with an optional badge) above its content.\n\n📍 **In the app:** the meta-ticket detail panel (Tickets tab → open a ticket) — wraps Description, Specifications, Spec Diffs, Plan and Sessions." } },
  },
  decorators: [(Story) => <div style={{ width: 300, background: "var(--panel)", padding: "var(--space-sm)", borderRadius: "var(--radius-md)" }}><Story /></div>],
  args: { title: "Specifications" },
  argTypes: { onHeaderClick: { table: { disable: true } } },
} satisfies Meta<typeof TicketSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Static: Story = {
  args: {
    title: "Specifications",
    children: (
      <div className="ticket-linked-list">
        <div className="ticket-linked-empty">No specs linked yet.</div>
      </div>
    ),
  },
};

export const Clickable: Story = {
  args: {
    title: "Description",
    onHeaderClick: () => {},
    active: true,
    children: <div className="ticket-description-preview"><div className="ticket-description-empty">No description yet</div></div>,
  },
};

export const WithBadge: Story = {
  args: {
    title: "Spec Diffs",
    onHeaderClick: () => {},
    badge: <span className="ticket-section-count">3 applied</span>,
  },
};
