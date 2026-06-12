import type { Meta, StoryObj } from "@storybook/react-vite";
import { StickyContextBar } from "./StickyContextBar";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { FALLBACK_SKILLS } from "@/constants/skills";
import "../ChatStream/ChatStream.css";

/**
 * StickyContextBar is the compact one-line session summary (skill · specs ·
 * model · permission mode · author) that sticks to the top of the transcript.
 * Resolves the skill icon/name from the settings store.
 */
const meta = {
  title: "Chat/StickyContextBar",
  component: StickyContextBar,
  beforeEach: () => {
    useSettingsStore.setState({ skills: FALLBACK_SKILLS });
  },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "StickyContextBar is the compact one-line session summary (skill · specs · model · permission mode · author) that sticks to the top of the transcript.\n\n📍 **In the app:** pinned to the top of the chat transcript (Sessions tab, and the ticket session view) once you scroll the session." } },
  },
  args: {
    skillId: "task-spec",
    specCount: 3,
    model: "claude-opus-4-8",
    permissionMode: "default",
    createdBy: "Arina",
    onScrollToTop: () => {},
  },
  argTypes: { onScrollToTop: { table: { disable: true } } },
} satisfies Meta<typeof StickyContextBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSkill: Story = {};
export const NoSkill: Story = { args: { skillId: undefined, specCount: 0, createdBy: undefined } };
