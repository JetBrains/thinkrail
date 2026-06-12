import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionContextMenu } from "./SessionContextMenu";
import "./compact.css";

/**
 * SessionContextMenu is the right-click menu on the chat transcript: switch
 * view mode, expand/collapse, copy transcript, and (on an answered question)
 * revise the answer. Positioned at the click coords.
 */
const meta = {
  title: "Chat/SessionContextMenu",
  component: SessionContextMenu,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "SessionContextMenu is the right-click menu on the chat transcript: switch view mode, expand/collapse, copy transcript, and (on an answered question) revise the answer.\n\n📍 **In the app:** a context menu in the chat stream (Sessions tab) when you right-click the transcript." } },
  },
  args: {
    x: 16,
    y: 16,
    viewMode: "classic",
    onSwitchViewMode: () => {},
    onExpandAll: () => {},
    onCollapseEvents: () => {},
    onCollapseAll: () => {},
    onCopyTranscript: () => {},
    onClose: () => {},
  },
  argTypes: {
    onSwitchViewMode: { table: { disable: true } },
    onExpandAll: { table: { disable: true } },
    onCollapseEvents: { table: { disable: true } },
    onCollapseAll: { table: { disable: true } },
    onCopyTranscript: { table: { disable: true } },
    onReviseAnswer: { table: { disable: true } },
    onClose: { table: { disable: true } },
  },
  decorators: [(Story) => <div style={{ position: "relative", height: 320 }}><Story /></div>],
} satisfies Meta<typeof SessionContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Classic: Story = {};
export const OnAnsweredQuestion: Story = { args: { onReviseAnswer: () => {} } };
