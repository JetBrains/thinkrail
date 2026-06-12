import type { Meta, StoryObj } from "@storybook/react-vite";
import { FrontmatterCard } from "./FrontmatterCard";

/**
 * FrontmatterCard is the collapsible YAML-frontmatter card shown atop a spec
 * doc, syntax-highlighted via a read-only Monaco editor (mounts on expand).
 * Renders nothing for empty frontmatter.
 */
const meta = {
  title: "Files/FrontmatterCard",
  component: FrontmatterCard,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "FrontmatterCard is the collapsible YAML-frontmatter card shown atop a spec doc, syntax-highlighted via a read-only Monaco editor (mounts on expand). Renders nothing for empty frontmatter.\n\n📍 **In the app:** at the top of an open spec/markdown file in the Files/Specs viewer (also reused in chat prompt previews)." } },
  },
  args: {
    value: "title: Agent Runner\nstatus: active\ntype: module-design\ncovers:\n  - backend/app/agent/\ntags: [agent, runtime]",
  },
} satisfies Meta<typeof FrontmatterCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
