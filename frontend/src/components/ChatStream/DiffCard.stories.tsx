import type { Meta, StoryObj } from "@storybook/react-vite";
import { DiffCard } from "./DiffCard";
import "./ChatStream.css";

/**
 * DiffCard renders an Edit/Write/NotebookEdit tool call as a collapsible code
 * diff (Monaco DiffEditor mounts when expanded). It derives the before/after
 * from the tool input.
 */
const OLD = `.btn {
  padding: 10px 24px;
  border-radius: 8px;
  background: #4d8d4a;
}`;

const NEW = `.btn {
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-md);
  background: var(--green);
}`;

const meta = {
  title: "Chat/DiffCard",
  component: DiffCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "DiffCard renders an Edit/Write/NotebookEdit tool call as a collapsible code diff (Monaco DiffEditor mounts when expanded), deriving before/after from the tool input.\n\n📍 **In the app:** in the chat transcript (Sessions tab) whenever the agent edits or writes a file.",
      },
    },
  },
  args: {
    toolName: "Edit",
    toolInput: { file_path: "frontend/src/components/Wizard/NewProjectForm.css", old_string: OLD, new_string: NEW },
    state: "success",
  },
} satisfies Meta<typeof DiffCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Edit: Story = {};

export const NewFile: Story = {
  args: {
    toolName: "Write",
    toolInput: { file_path: "frontend/src/components/ui/Button.tsx", content: "export function Button() {\n  return <button className=\"btn\" />;\n}\n" },
  },
};
