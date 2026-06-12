import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "./Button";
import "../Wizard/NewProjectForm.css";

/**
 * Button is the standard button component used across the app with multiple
 * variants (default, cancel, primary, approve, deny, muted) and sizes (md, sm, xs).
 */
const meta = {
  title: "Primitives/Button",
  component: Button,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The standard button component with six variants (default, cancel, primary, approve, deny, muted), three sizes (md=40px, sm=32px, xs=24px), and an optional trailing icon.\n\n📍 **In the app:** used throughout the app including form buttons, chat buttons (approval, deny, etc.), and navigation buttons.",
      },
    },
  },
  args: { children: "Button" },
  decorators: [(Story) => <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}><Story /></div>],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Back" } };
export const Cancel: Story = { args: { variant: "cancel", children: "Cancel" } };
export const Primary: Story = {
  args: {
    variant: "primary",
    children: "Next",
    trailingIcon: <ArrowRight size={16} strokeWidth={1.5} className="np-form-btn-icon" />,
  },
};
export const WithLeadingIcon: Story = {
  args: {
    variant: "primary",
    size: "sm",
    children: "New ticket",
    leadingIcon: <Plus size={16} strokeWidth={2} />,
  },
};
export const Disabled: Story = { args: { variant: "primary", children: "Next", disabled: true } };

export const Approve: Story = {
  args: {
    variant: "approve",
    children: "Approve",
  },
};

export const Deny: Story = {
  args: {
    variant: "deny",
    children: "Deny",
  },
};

export const Muted: Story = {
  args: {
    variant: "muted",
    children: "Dismiss",
  },
};

export const AllVariants: Story = {
  render: () => (
    <>
      <Button>Default</Button>
      <Button variant="cancel">Cancel</Button>
      <Button variant="primary" trailingIcon={<ArrowRight size={16} strokeWidth={1.5} className="np-form-btn-icon" />}>
        Primary
      </Button>
      <Button variant="approve">Approve</Button>
      <Button variant="deny">Deny</Button>
      <Button variant="muted">Muted</Button>
    </>
  ),
};

export const Small: Story = {
  args: {
    size: "sm",
    variant: "primary",
    children: "Small Button",
  },
};

export const ExtraSmall: Story = {
  args: {
    size: "xs",
    variant: "primary",
    children: "Extra Small",
  },
};

export const AllSizes: Story = {
  render: () => (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
          <Button size="md">Medium (40px)</Button>
          <Button size="sm">Small (32px)</Button>
          <Button size="xs">Extra Small (24px)</Button>
        </div>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
          <Button variant="primary" size="md">Medium (40px)</Button>
          <Button variant="primary" size="sm">Small (32px)</Button>
          <Button variant="primary" size="xs">Extra Small (24px)</Button>
        </div>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
          <Button variant="cancel" size="md">Medium (40px)</Button>
          <Button variant="cancel" size="sm">Small (32px)</Button>
          <Button variant="cancel" size="xs">Extra Small (24px)</Button>
        </div>
      </div>
    </>
  ),
};
