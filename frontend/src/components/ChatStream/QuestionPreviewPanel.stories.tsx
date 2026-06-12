import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuestionPreviewPanel } from "./QuestionPreviewPanel";
import "./ChatStream.css";

/**
 * QuestionPreviewPanel shows the description of the currently focused question
 * option, with a placeholder when nothing is focused.
 */
const meta = {
  title: "Chat/QuestionPreviewPanel",
  component: QuestionPreviewPanel,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "QuestionPreviewPanel shows the description of the currently focused question option, with a placeholder when nothing is focused.\n\n📍 **In the app:** the side preview pane of the question card in the chat stream (Sessions tab) when the agent asks you something." } },
  },
  args: { description: "Rewrite the Foundations using official ColorPalette/Typeset blocks. More idiomatic; drop redundant autodocs pages." },
} satisfies Meta<typeof QuestionPreviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithDescription: Story = {};
export const Empty: Story = { args: { description: "" } };
