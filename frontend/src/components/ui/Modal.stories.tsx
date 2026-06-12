import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Modal } from "./Modal";

/**
 * Modal renders a fixed backdrop and centers (or top-pins) whatever children
 * you pass — the content card itself is supplied by the caller. Real usages:
 * SettingsModal, CreateTicketModal, TrashModal (align="top"), CommandPalette.
 *
 * Modal returns null when `open` is false, so these stories drive `open` from
 * local state via an "Open modal" trigger.
 */
const meta = {
  title: "Primitives/Modal",
  component: Modal,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Renders a fixed backdrop and centers (or top-pins via `align`) whatever children you pass — the content card itself is supplied by the caller.\n\n📍 **In the app:** the backdrop behind overlays like `SettingsModal`, `CreateTicketModal`, `TrashModal` (`align=\"top\"`) and `CommandPalette`.",
      },
    },
  },
  args: { open: false, onClose: () => {}, children: null },
  argTypes: {
    align: { control: "radio", options: ["center", "top"], description: "Vertical placement" },
    open: { table: { disable: true } },
    onClose: { table: { disable: true } },
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

const triggerStyle: React.CSSProperties = {
  font: "var(--font-md) var(--font)",
  color: "var(--text)",
  background: "var(--elevated)",
  border: "1px solid var(--border2)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-sm) var(--space-md)",
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  width: 420,
  maxWidth: "90vw",
  background: "var(--panel)",
  border: "1px solid var(--border2)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-xl)",
  color: "var(--text)",
  boxShadow: "0 12px 48px rgba(0,0,0,0.4)",
};

function ModalDemo({ align }: { align?: "center" | "top" }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: "var(--space-xl)" }}>
      <button style={triggerStyle} onClick={() => setOpen(true)}>
        Open modal
      </button>
      <Modal open={open} onClose={() => setOpen(false)} align={align}>
        <div style={cardStyle}>
          <h2 style={{ font: "600 var(--font-xl) var(--font)", marginBottom: "var(--space-md)" }}>
            Modal title
          </h2>
          <p style={{ color: "var(--muted)", marginBottom: "var(--space-lg)" }}>
            Click the backdrop or a button below to close. The card is supplied by the caller —
            Modal only provides the backdrop and alignment.
          </p>
          <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
            <button style={triggerStyle} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              style={{ ...triggerStyle, background: "var(--blue)", borderColor: "var(--blue)", color: "#fff" }}
              onClick={() => setOpen(false)}
            >
              Confirm
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export const Centered: Story = {
  args: { align: "center" },
  render: (args) => <ModalDemo align={args.align} />,
};

export const TopAligned: Story = {
  args: { align: "top" },
  render: (args) => <ModalDemo align={args.align} />,
};
