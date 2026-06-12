import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuestionTabBar } from "./QuestionTabBar";
import type { Question } from "@/types/agent.ts";
import "./ChatStream.css";

/**
 * QuestionTabBar is the tab strip for a multi-question AskUserQuestion prompt:
 * one tab per question (by header), with the active tab highlighted and
 * answered tabs checked.
 */
const QUESTIONS: Question[] = [
  { question: "Which scope?", header: "Scope", options: [{ label: "Full", description: "" }] },
  { question: "Which app?", header: "Running app", options: [{ label: "Yes", description: "" }] },
  { question: "Theme?", header: "Theme", options: [{ label: "Dark", description: "" }] },
];

const meta = {
  title: "Chat/QuestionTabBar",
  component: QuestionTabBar,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "QuestionTabBar is the tab strip for a multi-question AskUserQuestion prompt: one tab per question, with the active tab highlighted and answered tabs checked.\n\n📍 **In the app:** the top of the question card in the chat stream (Sessions tab) when the agent asks multiple questions at once." } },
  },
  args: { questions: QUESTIONS, activeIndex: 1, answeredIndices: new Set([0]), onTabClick: () => {} },
  argTypes: { onTabClick: { table: { disable: true } } },
} satisfies Meta<typeof QuestionTabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};
export const AllAnswered: Story = { args: { activeIndex: 2, answeredIndices: new Set([0, 1, 2]) } };
