import type { Meta, StoryObj } from "@storybook/react";
import { TwoPanelLayout } from "./TwoPanelLayout";

const meta: Meta<typeof TwoPanelLayout> = {
  title: "Layout/TwoPanelLayout",
  component: TwoPanelLayout,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Two-panel layout with sphere background and blurred container. Used for wizard steps with chat input on left and content/document on right.\\n\\n" +
          "Features:\\n" +
          "- Sphere background image at bottom\\n" +
          "- Wide blurred backdrop (fills viewport minus 24px margins)\\n" +
          "- Container padding: 16px\\n" +
          "- Left and right panels: equal width (50/50 split)\\n" +
          "- Right panel: collapsible with arrow icon, --bg background\\n" +
          "- 24px gap between panels",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TwoPanelLayout>;

export const Default: Story = {
  args: {
    rightPanelTitle: "GOAL&REQUIREMENTS.md",
    leftPanel: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px", height: "100%" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600, marginBottom: "12px" }}>
            Chat Input Panel
          </h3>
          <p style={{ margin: 0, fontSize: "14px", opacity: 0.7 }}>
            Left panel for chat input, model selector, and controls.
          </p>
        </div>
        <div style={{
          flex: 1,
          padding: "16px",
          background: "rgba(255,255,255,0.05)",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          Chat input area
        </div>
      </div>
    ),
    rightPanel: (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600, marginBottom: "12px" }}>
            Content Panel
          </h3>
          <p style={{ margin: 0, fontSize: "14px", opacity: 0.7 }}>
            Right panel for document preview or other content. Click the collapse button to see the collapsed state.
          </p>
        </div>
        <div style={{
          flex: 1,
          padding: "16px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          Document/content area
        </div>
      </div>
    ),
  },
};

export const WithChatExample: Story = {
  args: {
    rightPanelTitle: "DESIGN_DOC.md",
    leftPanel: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <select style={{
            padding: "8px 12px",
            borderRadius: "6px",
            border: "none",
            background: "var(--input-bg)",
            color: "white",
            fontSize: "14px",
          }}>
            <option>GPT-4</option>
            <option>Claude</option>
          </select>
          <div style={{ display: "flex", gap: "8px" }}>
            <button style={{
              padding: "8px",
              borderRadius: "6px",
              border: "none",
              background: "#464857",
              color: "white",
              cursor: "pointer",
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}>
          <div style={{
            padding: "12px 16px",
            background: "rgba(140, 129, 255, 0.1)",
            borderRadius: "8px",
            fontSize: "14px",
            alignSelf: "flex-end",
            maxWidth: "80%",
          }}>
            Example user message
          </div>
          <div style={{
            padding: "12px 16px",
            background: "rgba(255, 255, 255, 0.05)",
            borderRadius: "8px",
            fontSize: "14px",
            maxWidth: "80%",
          }}>
            Example assistant response
          </div>
        </div>
        <div style={{
          padding: "12px 16px",
          background: "var(--input-bg)",
          borderRadius: "8px",
        }}>
          <input
            type="text"
            placeholder="Type your message..."
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: "white",
              fontSize: "14px",
              outline: "none",
            }}
          />
        </div>
      </div>
    ),
    rightPanel: (
      <div style={{ width: "100%", height: "100%" }}>
        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
            Document Preview
          </h3>
        </div>
        <div style={{
          padding: "20px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: "8px",
          fontSize: "14px",
          lineHeight: "1.6",
        }}>
          <p style={{ margin: "0 0 16px 0" }}>
            This panel displays the generated document or content as the wizard progresses.
          </p>
          <p style={{ margin: 0, opacity: 0.7 }}>
            The darker background (#1f1f21) helps distinguish the content area from the chat panel.
          </p>
        </div>
      </div>
    ),
  },
};

export const WithFormContent: Story = {
  args: {
    rightPanelTitle: "PREVIEW.md",
    leftPanel: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "24px", height: "100%" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ margin: 0, fontSize: "32px", fontWeight: 800, color: "#8c81ff" }}>
            Wizard Step
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: "15px", opacity: 0.8 }}>
            Guide the user through the process
          </p>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ fontSize: "13px", opacity: 0.6, marginBottom: "8px", display: "block" }}>
              Input Field
            </label>
            <input
              type="text"
              placeholder="Enter value..."
              style={{
                width: "100%",
                padding: "10px 16px",
                borderRadius: "8px",
                border: "none",
                background: "#272830",
                color: "white",
                fontSize: "15px",
              }}
            />
          </div>
          <div style={{ marginTop: "auto", display: "flex", gap: "12px", justifyContent: "flex-end" }}>
            <button style={{
              padding: "10px 24px",
              borderRadius: "8px",
              border: "none",
              background: "#464857",
              color: "white",
              fontSize: "15px",
              cursor: "pointer",
            }}>
              Back
            </button>
            <button style={{
              padding: "10px 24px",
              borderRadius: "8px",
              border: "none",
              background: "#8c81ff",
              color: "black",
              fontSize: "15px",
              cursor: "pointer",
            }}>
              Continue
            </button>
          </div>
        </div>
      </div>
    ),
    rightPanel: (
      <div style={{ width: "100%", height: "100%" }}>
        <h3 style={{ margin: "0 0 20px 0", fontSize: "20px", fontWeight: 700 }}>
          Live Preview
        </h3>
        <div style={{
          padding: "24px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: "8px",
          height: "calc(100% - 48px)",
        }}>
          Preview of what's being created appears here
        </div>
      </div>
    ),
  },
};
