import type { Meta, StoryObj } from "@storybook/react-vite";
import { StaleRefsBanner } from "./StaleRefsBanner";

/**
 * StaleRefsBanner is a warning strip shown when a spec references files/specs
 * that no longer exist, with an action button to clean them up.
 */
const meta = {
  title: "Primitives/StaleRefsBanner",
  component: StaleRefsBanner,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A warning strip shown when a spec references files/specs that no longer exist, with an action button to clean them up.\n\n📍 **In the app:** inside `DraftConfigCard` (session draft config) and the Tickets detail panel's `TicketInfo`.",
      },
    },
  },
  args: {
    message: "3 references point to files that no longer exist.",
    onFix: () => {},
  },
  argTypes: {
    onFix: { table: { disable: true } },
  },
} satisfies Meta<typeof StaleRefsBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomAction: Story = {
  args: {
    message: "This spec covers 2 files that were deleted.",
    actionLabel: "Remove refs",
  },
};
