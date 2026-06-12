import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionDock } from "./SessionDock";
import { useSettingsStore } from "@/store/settingsStore";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore";
import { FALLBACK_SKILLS } from "@/constants/skills";
import type { SessionMetrics } from "@/types/session";
import type { RuntimeCapabilities } from "@/types/rpc-methods";
import { RpcContext } from "@/api/hooks/useRpc";
import type { RpcClient } from "@/api/client";
import "@/components/ChatStream/ChatStream.css";

/**
 * SessionDock is the bottom "island" of a session: the SessionStatusLine
 * (model / permission / effort / cost + action slot) above the InputArea. It
 * owns the action-slot portal that places the Start/Stop/Continue buttons
 * inside the status line. This is the unit you actually see in the app — the
 * input is never shown without its status line.
 *
 * (The rendered Docs description — including the "in the app" pointer — is set
 * via `parameters.docs.description.component` below, since autodocs otherwise
 * shows the component's own TSDoc, not this comment.)
 */
const CAPS: RuntimeCapabilities = {
  models: [
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  ],
  permissionModes: [
    { value: "default", label: "Default" },
    { value: "acceptEdits", label: "Accept edits" },
  ],
  effortLevels: [
    { value: "auto", label: "Auto" },
    { value: "high", label: "High" },
  ],
};

const metrics: SessionMetrics = {
  costUsd: 0.42,
  turns: 3,
  toolCalls: 5,
  contextTokens: 27_200,
  contextMax: 1_000_000,
  durationMs: 95_000,
  filesChanged: {},
  contextUsage: {} as SessionMetrics["contextUsage"],
};

const meta = {
  title: "Chat/SessionDock",
  component: SessionDock,
  beforeEach: () => {
    useSettingsStore.setState({ skills: FALLBACK_SKILLS });
    useRuntimeCapsStore.setState({ capsByRuntime: { claude: CAPS } });
  },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The bottom \"island\" of a session: the SessionStatusLine (model / permission / effort / cost + action slot) above the InputArea. It owns the action-slot portal that places the Start/Stop/Continue buttons inside the status line — the input is never shown without its status line.\n\n📍 **In the app:** pinned to the bottom of the session view (the Sessions tab, and the left pane of the new-project / wizard chat layout). Rendered by `SessionPanel`; you only see it once a session is open.",
      },
    },
  },
  args: {
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "auto",
    metrics,
    status: "draft",
    projectCost: 0,
    sessionId: "story-dock",
    inputDisabled: false,
    placeholder: "Type a message to start, or adjust config above…",
    isDraft: true,
    onSend: () => {},
  },
  argTypes: {
    onSend: { table: { disable: true } },
    onChangeModel: { table: { disable: true } },
    onChangePermissionMode: { table: { disable: true } },
    onChangeEffort: { table: { disable: true } },
    onInterrupt: { table: { disable: true } },
    onEndSession: { table: { disable: true } },
    onBackground: { table: { disable: true } },
    onContinue: { table: { disable: true } },
    footer: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <RpcContext.Provider value={{} as RpcClient}>
        <div style={{ maxWidth: 820 }}>
          <Story />
        </div>
      </RpcContext.Provider>
    ),
  ],
} satisfies Meta<typeof SessionDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {};

export const Running: Story = {
  args: { status: "running", isDraft: false, isRunning: true, canInterrupt: true, projectCost: 0.42, placeholder: "Agent is working…" },
};
