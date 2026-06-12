import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "./FormField";
// np-form-* field/label/input styles live in the project form stylesheet.
import "../Wizard/NewProjectForm.css";

/**
 * FormField is the labeled-field wrapper used in the new-project forms: a label
 * above a control (children), with an optional error message below.
 */
const meta = {
  title: "Primitives/FormField",
  component: FormField,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The labeled-field wrapper: a label above a control (children), with an optional error message below.\n\n📍 **In the app:** wraps each input in the new-project \"Describe\" forms (`NewProjectForm` / `NewProjectWelcome`).",
      },
    },
  },
  decorators: [(Story) => <div style={{ width: 420 }}><Story /></div>],
  args: {
    label: "Project name",
    children: <input className="np-form-input" type="text" placeholder="e.g. inventory service" />,
  },
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = {};

export const WithError: Story = {
  args: {
    children: <input className="np-form-input np-form-input--error" type="text" defaultValue="" />,
    error: "Please enter a project name",
  },
};

export const Textarea: Story = {
  args: {
    label: "Description",
    children: (
      <div className="np-form-textarea-wrap">
        <textarea className="np-form-textarea" rows={5} placeholder="describe your project idea…" />
      </div>
    ),
  },
};
