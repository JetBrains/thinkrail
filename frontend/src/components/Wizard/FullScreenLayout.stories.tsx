import type { Meta, StoryObj } from "@storybook/react";
import { FullScreenLayout } from "./FullScreenLayout";

const meta: Meta<typeof FullScreenLayout> = {
  title: "Layout/FullScreenLayout",
  component: FullScreenLayout,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Full-screen layout with sphere background and blurred container. Used for wizard forms and single-panel screens.\n\n" +
          "Features:\n" +
          "- Sphere background image at bottom\n" +
          "- Wide blurred backdrop (fills viewport minus 24px margins)\n" +
          "- Centered content area with customizable max-width\n" +
          "- Responsive behavior for smaller screens",
      },
    },
  },
  argTypes: {
    maxWidth: {
      control: { type: "number", min: 300, max: 1200, step: 10 },
      description: "Maximum width of the content area in pixels",
      defaultValue: 534,
    },
  },
};

export default meta;
type Story = StoryObj<typeof FullScreenLayout>;

export const Default: Story = {
  args: {
    maxWidth: 534,
    children: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ margin: 0, fontSize: "40px", fontWeight: 800, color: "#8c81ff" }}>
            Example Heading
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: "15px", opacity: 0.8 }}>
            This is an example of content inside the full-screen layout.
          </p>
        </div>
        <div style={{ width: "100%", padding: "20px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
          Content area
        </div>
      </div>
    ),
  },
};

export const WideContent: Story = {
  args: {
    maxWidth: 800,
    children: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ margin: 0, fontSize: "40px", fontWeight: 800, color: "#8c81ff" }}>
            Wide Layout
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: "15px", opacity: 0.8 }}>
            Content area can be wider by setting maxWidth prop.
          </p>
        </div>
        <div style={{ width: "100%", padding: "40px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
          Wide content area (800px max-width)
        </div>
      </div>
    ),
  },
};

export const NarrowContent: Story = {
  args: {
    maxWidth: 400,
    children: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ margin: 0, fontSize: "32px", fontWeight: 800, color: "#8c81ff" }}>
            Narrow
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: "14px", opacity: 0.8 }}>
            Narrower layout for focused content.
          </p>
        </div>
        <div style={{ width: "100%", padding: "20px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
          Narrow content (400px)
        </div>
      </div>
    ),
  },
};

export const FormExample: Story = {
  args: {
    maxWidth: 534,
    children: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ margin: 0, fontSize: "40px", fontWeight: 800, color: "#8c81ff" }}>
            Form Example
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: "15px", opacity: 0.8 }}>
            Example wizard form layout
          </p>
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ fontSize: "13px", opacity: 0.6, marginBottom: "8px", display: "block" }}>
              Field Label
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
          <div>
            <label style={{ fontSize: "13px", opacity: 0.6, marginBottom: "8px", display: "block" }}>
              Description
            </label>
            <textarea
              placeholder="Enter description..."
              rows={5}
              style={{
                width: "100%",
                padding: "10px 16px",
                borderRadius: "8px",
                border: "none",
                background: "#272830",
                color: "white",
                fontSize: "15px",
                resize: "none",
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: "16px", justifyContent: "flex-end", marginTop: "24px" }}>
          <button
            style={{
              padding: "10px 32px",
              borderRadius: "8px",
              border: "none",
              background: "#464857",
              color: "white",
              fontSize: "15px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            style={{
              padding: "10px 32px",
              borderRadius: "8px",
              border: "none",
              background: "#8c81ff",
              color: "black",
              fontSize: "15px",
              cursor: "pointer",
            }}
          >
            Submit
          </button>
        </div>
      </div>
    ),
  },
};
