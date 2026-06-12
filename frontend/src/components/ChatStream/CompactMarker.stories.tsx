import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompactMarker } from "./CompactMarker";
import "./ChatStream.css";

/**
 * CompactMarker is the divider shown in the chat stream when the context window
 * was compacted, optionally showing the pre-compaction token count.
 */
const meta = {
  title: "Chat/CompactMarker",
  component: CompactMarker,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "CompactMarker is the divider shown in the chat stream when the context window was compacted, optionally showing the pre-compaction token count.\n\n📍 **In the app:** in the chat transcript (Sessions tab) at the point a long session was auto-compacted to free up context.",
      },
    },
  },
  args: { preTokens: 128_000 },
} satisfies Meta<typeof CompactMarker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTokens: Story = {};
export const NoTokens: Story = { args: { preTokens: undefined } };
