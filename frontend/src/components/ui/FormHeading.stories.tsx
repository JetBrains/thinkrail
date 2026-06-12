import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormHeading } from "./FormHeading";
import "../Wizard/NewProjectForm.css";

/**
 * FormHeading is the accent display heading atop the new-project forms — a large
 * Sentient title with an optional subtitle.
 */
const meta = {
  title: "Primitives/FormHeading",
  component: FormHeading,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The accent display heading atop the new-project forms — a large Sentient title with an optional subtitle.\n\n📍 **In the app:** the heading above the \"Describe\" form (`NewProjectForm` / `NewProjectWelcome`).",
      },
    },
  },
  args: {
    title: "Describe Your Project",
    subtitle: (
      <>
        Bonsai will help shape your idea into a clear<br />
        Goal &amp; Requirements document.
      </>
    ),
  },
} satisfies Meta<typeof FormHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const TitleOnly: Story = { args: { subtitle: undefined } };
