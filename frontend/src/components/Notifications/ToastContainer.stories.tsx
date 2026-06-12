import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToastContainer } from "./ToastContainer";
import { useNotificationStore } from "@/store/notificationStore.ts";

/**
 * ToastContainer renders the stack of transient notifications (bottom corner),
 * color-coded by event type via a left border. Reads the notification store, so
 * the story seeds a toast of each type.
 */
const meta = {
  title: "Notifications/ToastContainer",
  component: ToastContainer,
  beforeEach: () => {
    useNotificationStore.setState({
      toasts: [
        { id: "1", eventType: "question", message: "Agent is asking a question", persistent: true, createdAt: Date.now() },
        { id: "2", eventType: "approval", message: "Action requires approval: Bash", persistent: true, createdAt: Date.now() },
        { id: "3", eventType: "success", message: "Session complete", persistent: true, createdAt: Date.now() },
        { id: "4", eventType: "error", message: "Session error: context_overflow", persistent: true, createdAt: Date.now() },
        { id: "5", eventType: "notification", message: "Spec index refreshed", persistent: true, createdAt: Date.now() },
      ],
    });
  },
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "ToastContainer renders the stack of transient notifications, color-coded by event type via a left border.\n\n📍 **In the app:** the stack of transient toasts anchored bottom-right (e.g. \"Agent has a question\", errors), rendered at the App root." } },
  },
} satisfies Meta<typeof ToastContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllTypes: Story = {};
