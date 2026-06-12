import type { Meta, StoryObj } from "@storybook/react-vite";
import { SystemMessage } from "./SystemMessage";
import "./ChatStream.css";

/**
 * SystemMessage is a centered, muted status line in the chat stream. The "ok"
 * variant tints it for success.
 */
const meta = {
  title: "Chat/SystemMessage",
  component: SystemMessage,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "SystemMessage is a centered, muted status line in the chat stream. The \"ok\" variant tints it for success.\n\n📍 **In the app:** in the chat transcript (Sessions tab) for status notes like \"Session resumed\" or \"Turn interrupted\".",
      },
    },
  },
  args: { text: "Session resumed", variant: "info" },
  argTypes: { variant: { control: "radio", options: ["info", "ok"] } },
} satisfies Meta<typeof SystemMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};
export const Ok: Story = { args: { text: "Spec saved", variant: "ok" } };
