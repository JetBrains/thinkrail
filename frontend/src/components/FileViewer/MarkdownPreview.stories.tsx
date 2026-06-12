import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownPreview } from "./MarkdownPreview";

/**
 * MarkdownPreview renders spec/doc markdown: GitHub-flavored markdown (headings,
 * lists, tables, code), a frontmatter card when present, and Mermaid diagrams.
 * Has a zoom bar.
 */
const DOC = `---
title: Agent Runner
status: active
---

# Agent Runner

The runner executes a single agent **session** and streams events.

## Responsibilities
- Spawn the agent process
- Stream \`AgentEvent\`s over WebSocket
- Track tool calls and cost

| Phase | Output |
|-------|--------|
| start | sessionStart |
| run   | textDelta / toolCall |
| end   | done |

\`\`\`mermaid
graph LR
  A[Prompt] --> B[Runner]
  B --> C[Tools]
  B --> D[Events]
\`\`\`
`;

const meta = {
  title: "Files/MarkdownPreview",
  component: MarkdownPreview,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "MarkdownPreview renders spec/doc markdown: GitHub-flavored markdown (headings, lists, tables, code), a frontmatter card when present, and Mermaid diagrams. Has a zoom bar.\n\n📍 **In the app:** in the file viewer when previewing a markdown/spec file (open a file from the Files/Specs tree)." } },
  },
  args: { content: DOC },
} satisfies Meta<typeof MarkdownPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SpecDoc: Story = {};
export const PlainMarkdown: Story = {
  args: { content: "# Hello\n\nA simple paragraph with a [link](#) and `inline code`.\n\n- one\n- two\n- three" },
};
