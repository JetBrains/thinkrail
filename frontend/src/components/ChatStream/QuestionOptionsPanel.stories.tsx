import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuestionOptionsPanel } from "./QuestionOptionsPanel";
import type { Question } from "@/types/agent.ts";
import "./ChatStream.css";

/**
 * QuestionOptionsPanel renders the selectable options for one AskUserQuestion,
 * plus an "Other:" free-text row. Single-select uses radios (●/○), multi-select
 * uses checkboxes (☑/☐). The highlighted row is the keyboard cursor.
 */
const QUESTION: Question = {
  question: "How should I handle the token stories?",
  header: "Token stories",
  options: [
    { label: "Refactor to native blocks", description: "Use ColorPalette/Typeset." },
    { label: "Keep custom, polish it", description: "Clean up the hand-rolled version." },
    { label: "Leave as-is", description: "Accept and move on." },
  ],
};

const meta = {
  title: "Chat/QuestionOptionsPanel",
  component: QuestionOptionsPanel,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "QuestionOptionsPanel renders the selectable options (radios for single-select, checkboxes for multi-select) plus an \"Other:\" free-text row for one AskUserQuestion.\n\n📍 **In the app:** the body of the question card inside the chat stream (Sessions tab) when the agent asks you something." } },
  },
  args: {
    question: QUESTION,
    highlightedIndex: 0,
    selectedIndex: 0,
    checkedIndices: new Set<number>(),
    otherText: "",
    onOptionClick: () => {},
    onOtherTextChange: () => {},
    otherInputRef: { current: null },
  },
  argTypes: {
    onOptionClick: { table: { disable: true } },
    onOtherTextChange: { table: { disable: true } },
    otherInputRef: { table: { disable: true } },
  },
} satisfies Meta<typeof QuestionOptionsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSelect: Story = {};
export const MultiSelect: Story = {
  args: {
    question: { ...QUESTION, multiSelect: true },
    selectedIndex: null,
    checkedIndices: new Set([0, 2]),
  },
};
