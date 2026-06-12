import type { Meta, StoryObj } from "@storybook/react";
import { SessionsViewLayout } from "./SessionsViewLayout";

const meta: Meta<typeof SessionsViewLayout> = {
  title: "Layout/SessionsViewLayout",
  component: SessionsViewLayout,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Overall layout for sessions view with sphere background and island-style panels.\n\n" +
          "Features:\n" +
          "- Sphere background image at bottom center\n" +
          "- Left panel (SessionsLeftPanel) - 360px default, resizable, collapsible navigation with tabs\n" +
          "- Main content area (SessionContentLayout) - flexible width, contains session chat and context panel\n" +
          "- 16px gap between panels\n" +
          "- 24px margins around the entire layout",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SessionsViewLayout>;

const mockLeftPanel = (
  <div style={{
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "rgba(22, 22, 24, 0.8)",
    backdropFilter: "blur(50px)",
    borderRadius: "8px",
    padding: "8px",
    width: "360px",
  }}>
    <div style={{
      display: "flex",
      gap: "0",
      padding: "8px 8px 0 8px",
      borderBottom: "1px solid var(--border)",
      marginBottom: "8px",
    }}>
      <button style={{
        padding: "8px 12px",
        background: "transparent",
        border: "none",
        color: "var(--text)",
        fontSize: "var(--font-sm)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        cursor: "pointer",
        borderBottom: "2px solid white",
        marginBottom: "-1px",
      }}>
        Sessions
      </button>
      <button style={{
        padding: "8px 12px",
        background: "transparent",
        border: "none",
        color: "var(--muted)",
        fontSize: "var(--font-sm)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        cursor: "pointer",
      }}>
        Tickets
      </button>
      <button style={{
        padding: "8px 12px",
        background: "transparent",
        border: "none",
        color: "var(--muted)",
        fontSize: "var(--font-sm)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        cursor: "pointer",
      }}>
        Specs
      </button>
    </div>
    <div style={{ flex: 1, padding: "8px" }}>
      <div style={{
        padding: "12px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        marginBottom: "8px",
      }}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text)" }}>Session 1</div>
        <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>Running</div>
      </div>
      <div style={{
        padding: "12px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
      }}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text)" }}>Session 2</div>
        <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>Done</div>
      </div>
    </div>
  </div>
);

const mockMainContent = (
  <div style={{
    display: "flex",
    gap: "24px",
    height: "100%",
    background: "rgba(22, 22, 24, 0.8)",
    backdropFilter: "blur(50px)",
    borderRadius: "8px",
    padding: "8px",
  }}>
    <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ padding: "16px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Session Chat</h3>
        <p style={{ margin: "8px 0 0", fontSize: "14px", opacity: 0.7 }}>
          Main content - chat stream with tabs
        </p>
      </div>
      <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "16px" }}>
        Chat messages, tool calls, responses...
      </div>
    </div>
    <div style={{ flex: 1, background: "var(--bg)", borderRadius: "8px", padding: "16px" }}>
      <div style={{ padding: "16px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Context</h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", opacity: 0.7 }}>
          Agent context panel
        </p>
      </div>
    </div>
  </div>
);

export const FullLayout: Story = {
  args: {
    leftPanel: mockLeftPanel,
    mainContent: mockMainContent,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Full sessions view layout showing:\n" +
          "- Left navigation panel (SessionsLeftPanel) with tabs for Tickets/Sessions/Specs/Files\n" +
          "- Main content area (SessionContentLayout) with chat and context panels\n" +
          "- Sphere background visible at the bottom\n" +
          "- Both panels use island-style blurred containers",
      },
    },
  },
};
