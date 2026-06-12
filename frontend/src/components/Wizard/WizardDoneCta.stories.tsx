import type { Meta, StoryObj } from "@storybook/react-vite";
import { WizardDoneCta } from "./WizardDoneCta";
import "./WizardDonePanel.css";

/**
 * WizardDoneCta is a single "next step" card on the wizard done screen: a
 * title, optional description, and a trailing arrow. The "primary" variant is
 * the highlighted hero action; "alt" is a secondary start/navigate step.
 */
const meta = {
  title: "Wizard/WizardDoneCta",
  component: WizardDoneCta,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "WizardDoneCta is a single \"next step\" card on the wizard done screen: a title, optional description, and a trailing arrow. The \"primary\" variant is the highlighted hero action; \"alt\" is a secondary start/navigate step.\n\n📍 **In the app:** the next-step CTA cards on the wizard done screen (end of the new-project / wizard flow)." } },
  },
  args: {
    title: "Continue → Architecture",
    description: "Sketch the stack & modules in a DESIGN_DOC.md before tickets start running.",
    onClick: () => {},
  },
  argTypes: { onClick: { table: { disable: true } } },
  decorators: [(Story) => <div style={{ maxWidth: 520, background: "var(--bg)", padding: "var(--space-md)" }}><Story /></div>],
} satisfies Meta<typeof WizardDoneCta>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: "primary" } };

export const Alt: Story = {
  args: {
    variant: "alt",
    title: "Skip → Open workspace",
    description: "Architecture can wait. Land on the board now.",
  },
};

export const NoDescription: Story = {
  args: { variant: "alt", title: "Open the board", description: undefined },
};
