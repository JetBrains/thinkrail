import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Input } from "./Input";
import { TextInput } from "./TextInput";
import { Textarea } from "./Textarea";
import { PathInput } from "./PathInput";
import { FileAttach, type AttachedFile } from "./FileAttach";
import "../Wizard/NewProjectForm.css";

/**
 * The project form controls: Input, TextInput, Textarea, PathInput and FileAttach.
 * Input uses design tokens (--input-bg, --white-20), while the others use np-form-* classes.
 */
const meta = {
  title: "Primitives/Form Controls",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The project form controls — `Input`, `TextInput`, `Textarea`, `PathInput` and `FileAttach`.\n\n**Input** uses design tokens (`--input-bg`, `--white-20`) for styling.\n\n**TextInput, Textarea, PathInput, FileAttach** use the `np-form-*` classes.\n\n📍 **In the app:** the fields of the new-project \"Describe\" forms (`NewProjectForm` / `NewProjectWelcome`).",
      },
    },
  },
  decorators: [(Story) => <div style={{ width: 460 }}><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const InputDefault: Story = {
  render: () => <Input placeholder="e.g. inventory service" defaultValue="" />,
};

export const InputWithValue: Story = {
  render: () => <Input placeholder="e.g. inventory service" defaultValue="my-project" />,
};

export const InputError: Story = {
  render: () => <Input placeholder="e.g. inventory service" error defaultValue="" />,
};

export const InputDisabled: Story = {
  render: () => <Input placeholder="e.g. inventory service" disabled defaultValue="" />,
};

export const Text: Story = {
  render: () => <TextInput placeholder="e.g. inventory service" defaultValue="" />,
};

export const TextWithError: Story = {
  render: () => <TextInput placeholder="Project name" error defaultValue="" />,
};

export const MultilineTextarea: Story = {
  render: () => (
    <div className="np-form-textarea-wrap">
      <Textarea rows={5} placeholder="describe your project idea…" />
    </div>
  ),
};

export const Path: Story = {
  render: function PathStory() {
    const [v, setV] = useState("");
    return <PathInput value={v} onChange={setV} placeholder="choose a root folder" onBrowse={() => setV("/Users/you/src/demo")} />;
  },
};

export const PathDisabled: Story = {
  render: () => <PathInput value="~/src/inventory-service" disabled />,
};

export const FileAttachment: Story = {
  render: function FileStory() {
    const [file, setFile] = useState<AttachedFile | null>(null);
    return <FileAttach attachedFile={file} onAttach={setFile} />;
  },
};
