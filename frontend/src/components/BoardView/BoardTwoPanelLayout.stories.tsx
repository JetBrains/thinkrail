import type { Meta, StoryObj } from "@storybook/react";
import { BoardTwoPanelLayout } from "./BoardTwoPanelLayout";

const meta: Meta<typeof BoardTwoPanelLayout> = {
  title: "Layout/BoardTwoPanelLayout",
  component: BoardTwoPanelLayout,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Two-panel layout for board view with sphere background and blurred container.\n\n" +
          "Features:\n" +
          "- Sphere background image at bottom\n" +
          "- Wide blurred backdrop (fills viewport minus 24px margins)\n" +
          "- Both panels have the same visual styling\n" +
          "- 16px gap between panels\n" +
          "- Right panel is collapsible with collapse/expand buttons\n" +
          "- Collapsed state shows a slim 48px strip with expand button",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof BoardTwoPanelLayout>;

const mockBoardContent = (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "16px" }}>
    <div style={{ padding: "16px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
      <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Board</h3>
      <p style={{ margin: "8px 0 0", fontSize: "14px", opacity: 0.7 }}>
        Left panel - board kanban view
      </p>
    </div>
    <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "16px" }}>
      Board content area
    </div>
  </div>
);

const mockTicketDetail = (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "16px" }}>
    <div style={{ padding: "16px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
      <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Ticket Detail</h3>
      <p style={{ margin: "8px 0 0", fontSize: "14px", opacity: 0.7 }}>
        Right panel - ticket preview (collapsible)
      </p>
    </div>
    <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "16px" }}>
      <p style={{ margin: 0, fontSize: "14px", opacity: 0.6 }}>
        Ticket information, description, history, etc.
      </p>
      <p style={{ marginTop: "12px", fontSize: "13px", opacity: 0.5 }}>
        Click the collapse button (top-right) to collapse this panel.
      </p>
    </div>
  </div>
);

export const BoardOnly: Story = {
  args: {
    leftPanel: mockBoardContent,
  },
};

export const BoardWithTicket: Story = {
  args: {
    leftPanel: mockBoardContent,
    rightPanel: mockTicketDetail,
  },
};
