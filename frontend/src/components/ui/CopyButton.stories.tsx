import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyButton } from "./CopyButton";

/**
 * CopyButton copies `text` to the clipboard and flips its label to "Copied" for
 * 2s. It's intentionally unstyled — callers pass a `className` to style it
 * (e.g. SettingsModal's `server-info-copy-btn`). Click it to see the
 * confirmation.
 */
const meta = {
  title: "Primitives/CopyButton",
  component: CopyButton,
  parameters: {
    docs: {
      description: {
        component:
          "Copies `text` to the clipboard and flips its label to \"Copied\" for 2s. Intentionally unstyled — callers pass a `className`.\n\n📍 **In the app:** the copy buttons in `SettingsModal` (e.g. the server-info IP/address rows).",
      },
    },
  },
  args: { text: "192.168.0.10:3000" },
  argTypes: {
    text: { control: "text", description: "Value copied to clipboard" },
    children: { control: "text", description: "Custom label (defaults to “Copy”)" },
  },
  // Give the unstyled button a minimal look so it's visible in isolation.
  decorators: [
    (Story) => (
      <div style={{ padding: "var(--space-lg)" }}>
        <style>{`
          .sb-copy {
            font: var(--font-sm) var(--font);
            color: var(--text);
            background: var(--elevated);
            border: 1px solid var(--border2);
            border-radius: var(--radius-sm);
            padding: var(--space-xs) var(--space-sm);
            cursor: pointer;
          }
        `}</style>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { className: "sb-copy" },
};

export const CustomLabel: Story = {
  args: { className: "sb-copy", children: "Copy IP" },
};
