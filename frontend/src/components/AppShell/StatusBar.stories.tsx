import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBar } from "./StatusBar";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import type { SpecEntry } from "@/types/spec.ts";
import "./AppShell.css";

/**
 * StatusBar is the bottom bar: spec progress (done/active/pending), running
 * sessions, and quick actions. Reads spec / session / vis stores, seeded here
 * with a few specs and no live sessions.
 */
function spec(id: string, status: string): SpecEntry {
  return { id, type: "module-design", status, title: id, path: "", covers: [], tags: [], created: "", updated: "" };
}

const meta = {
  title: "Shell/StatusBar",
  component: StatusBar,
  beforeEach: () => {
    useSpecStore.setState({
      specs: [spec("a", "done"), spec("b", "done"), spec("c", "active"), spec("d", "draft"), spec("e", "draft")],
    });
    useSessionStore.setState({ sessions: new Map(), openTabs: new Set() });
  },
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "StatusBar is the bottom bar: spec progress (done/active/pending), running sessions, and quick actions.\n\n📍 **In the app:** the app footer, rendered at the bottom of AppShell (coverage / tasks done / lint counts)." } },
  },
  args: { onOpenSessionManager: () => {} },
  argTypes: { onOpenSessionManager: { table: { disable: true } } },
  decorators: [(Story) => <div style={{ position: "relative", height: 120, display: "flex", alignItems: "flex-end" }}><Story /></div>],
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
