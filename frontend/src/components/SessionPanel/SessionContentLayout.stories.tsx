import type { Meta, StoryObj } from "@storybook/react";
import { SessionContentLayout } from "./SessionContentLayout";

const meta: Meta<typeof SessionContentLayout> = {
  title: "Layout/SessionContentLayout",
  component: SessionContentLayout,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Content-only two-panel layout for sessions view (no background wrapper).\n\n" +
          "Features:\n" +
          "- Blurred backdrop container with 8px padding\n" +
          "- Left panel takes 2/3 width, right panel takes 1/3\n" +
          "- Right panel is collapsible with collapse/expand buttons\n" +
          "- Collapsed state shows a slim 48px strip with rotated title\n" +
          "- Single panel mode (.session-content-single) when no right panel provided\n" +
          "- Used within SessionsViewLayout which provides the sphere background",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SessionContentLayout>;

const mockSessionContent = (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "16px" }}>
    <div style={{ padding: "16px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
      <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Session Chat</h3>
      <p style={{ margin: "8px 0 0", fontSize: "14px", opacity: 0.7 }}>
        Left panel - chat stream and input area
      </p>
    </div>
    <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "16px" }}>
      <p style={{ margin: 0, fontSize: "14px", opacity: 0.6 }}>
        Chat messages, tool calls, assistant responses...
      </p>
    </div>
  </div>
);

const mockContextPanel = (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "16px" }}>
    <div style={{ padding: "16px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
      <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Context</h3>
      <p style={{ margin: "8px 0 0", fontSize: "14px", opacity: 0.7 }}>
        Right panel - agent context (collapsible)
      </p>
    </div>
    <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "16px" }}>
      <p style={{ margin: 0, fontSize: "14px", opacity: 0.6 }}>
        Specs, files, connected tasks, etc.
      </p>
      <p style={{ marginTop: "12px", fontSize: "13px", opacity: 0.5 }}>
        Click the collapse button (top-right) to collapse this panel.
      </p>
    </div>
  </div>
);

export const SinglePanel: Story = {
  args: {
    leftPanel: mockSessionContent,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Single panel mode - uses `.session-content-single` class with 8px padding. " +
          "This is rendered when no right panel is provided.",
      },
    },
  },
};

export const TwoPanel: Story = {
  args: {
    leftPanel: mockSessionContent,
    rightPanel: mockContextPanel,
    rightPanelTitle: "Context",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Two-panel mode with collapsible right panel (1/3 width). " +
          "Left panel takes 2/3 width. Right panel can be collapsed to a 48px strip with rotated title.",
      },
    },
  },
};
