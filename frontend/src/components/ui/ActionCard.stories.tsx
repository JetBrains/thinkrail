import type { Meta, StoryObj } from "@storybook/react-vite";
import { Grid2X2Plus, FolderHeart } from "lucide-react";
import { ActionCard } from "./ActionCard";
import "../ProjectPicker/ProjectPicker.css";

/**
 * ActionCard is the large choice card on the project picker: an icon, a title
 * and a subtitle. The `primary` variant is highlighted green.
 */
const meta = {
  title: "Primitives/ActionCard",
  component: ActionCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The large choice card on the project picker: an icon, a title and a subtitle. The `primary` variant is highlighted green.\n\n📍 **In the app:** the two big cards on the initial project-picker screen — \"Start a new project\" and \"Open an existing project\". Rendered by `ProjectPicker`.",
      },
    },
  },
  args: { onClick: () => {} },
  argTypes: { onClick: { table: { disable: true } } },
} satisfies Meta<typeof ActionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    primary: true,
    icon: <Grid2X2Plus size={20} strokeWidth={1.5} className="picker-cta-icon" />,
    title: "Start a new project",
    subtitle: "Idea → Goal & Requirements doc",
  },
};

export const Secondary: Story = {
  args: {
    icon: <FolderHeart size={20} strokeWidth={1.5} className="picker-cta-icon" />,
    title: "Open an existing project",
    subtitle: "ThinkRail will investigate the code with you",
  },
};
