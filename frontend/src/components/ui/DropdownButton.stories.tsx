import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, FolderPlus, Code } from "lucide-react";
import { DropdownButton } from "./DropdownButton";
import "../Wizard/NewProjectForm.css";

/**
 * DropdownButton is a button with a dropdown menu that shows options on click.
 * It extends the Button component with dropdown functionality.
 */
const meta = {
  title: "Primitives/DropdownButton",
  component: DropdownButton,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A button with a dropdown menu. Extends the Button component (`np-form-btn` family) with dropdown functionality. Supports all button variants (default, cancel, primary) and sizes (md=40px, sm=32px, xs=24px).",
      },
    },
  },
  args: {
    children: "New",
    options: [
      { label: "New File", value: "file" },
      { label: "New Folder", value: "folder" },
      { label: "New Project", value: "project" },
    ],
    onSelect: (value: string) => console.log("Selected:", value),
  },
  decorators: [(Story) => <div style={{ display: "flex", gap: "var(--space-sm)", padding: "100px" }}><Story /></div>],
} satisfies Meta<typeof DropdownButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: "primary",
    children: "New",
  },
};

export const Default: Story = {
  args: {
    variant: "default",
    children: "Actions",
  },
};

export const Cancel: Story = {
  args: {
    variant: "cancel",
    children: "Options",
  },
};

export const WithIcons: Story = {
  args: {
    variant: "primary",
    children: "Create",
    options: [
      { label: "New File", value: "file", icon: <FileText size={16} /> },
      { label: "New Folder", value: "folder", icon: <FolderPlus size={16} /> },
      { label: "New Project", value: "project", icon: <Code size={16} /> },
    ],
  },
};

export const WithDisabledOption: Story = {
  args: {
    variant: "primary",
    children: "Actions",
    options: [
      { label: "Edit", value: "edit" },
      { label: "Delete", value: "delete", disabled: true },
      { label: "Duplicate", value: "duplicate" },
    ],
  },
};

export const Small: Story = {
  args: {
    variant: "primary",
    size: "sm",
    children: "New",
  },
};

export const ExtraSmall: Story = {
  args: {
    variant: "primary",
    size: "xs",
    children: "New",
  },
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center" }}>
      <DropdownButton
        variant="primary"
        size="md"
        options={[
          { label: "Option 1", value: "1" },
          { label: "Option 2", value: "2" },
        ]}
        onSelect={(value) => console.log("Selected:", value)}
      >
        Medium
      </DropdownButton>
      <DropdownButton
        variant="primary"
        size="sm"
        options={[
          { label: "Option 1", value: "1" },
          { label: "Option 2", value: "2" },
        ]}
        onSelect={(value) => console.log("Selected:", value)}
      >
        Small
      </DropdownButton>
      <DropdownButton
        variant="primary"
        size="xs"
        options={[
          { label: "Option 1", value: "1" },
          { label: "Option 2", value: "2" },
        ]}
        onSelect={(value) => console.log("Selected:", value)}
      >
        Extra Small
      </DropdownButton>
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center" }}>
      <DropdownButton
        variant="default"
        options={[
          { label: "Option 1", value: "1" },
          { label: "Option 2", value: "2" },
        ]}
        onSelect={(value) => console.log("Selected:", value)}
      >
        Default
      </DropdownButton>
      <DropdownButton
        variant="cancel"
        options={[
          { label: "Option 1", value: "1" },
          { label: "Option 2", value: "2" },
        ]}
        onSelect={(value) => console.log("Selected:", value)}
      >
        Cancel
      </DropdownButton>
      <DropdownButton
        variant="primary"
        options={[
          { label: "Option 1", value: "1" },
          { label: "Option 2", value: "2" },
        ]}
        onSelect={(value) => console.log("Selected:", value)}
      >
        Primary
      </DropdownButton>
    </div>
  ),
};
