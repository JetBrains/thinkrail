import type { Meta, StoryObj } from "@storybook/react-vite";
import { DraftConfigCard } from "./DraftConfigCard";
import { useSessionStore } from "@/store/sessionStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useSpecStore } from "@/store/specStore";
import { useBoardStore } from "@/store/boardStore";
import { useUiStore } from "@/store/uiStore";
import { FALLBACK_SKILLS } from "@/constants/skills";
import type { Session } from "@/types/session";
import type { ModelDef } from "@/utils/models";
import { RpcContext } from "@/api/hooks/useRpc";
import type { RpcClient } from "@/api/client";
import "./DraftConfigCard.css";

/**
 * DraftConfigCard is the pre-start session config: name, attachments (skill /
 * specs / ticket / files), model + permission + turns + effort, a collapsible
 * system-prompt preview, and Discard / Start Session. Reads the session from the
 * session store, so the story seeds a draft session plus the supporting stores.
 */
const SID = "story-draft";

const MODELS: ModelDef[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", group: "current", contextWindow: 1_000_000 },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", group: "current", contextWindow: 1_000_000 },
];

const session = {
  thinkrailSid: SID,
  name: "Session 1",
  skillId: null,
  specIds: [],
  filePaths: [],
  status: "draft",
  model: "claude-opus-4-8",
  permissionMode: "default",
  effort: "auto",
  maxTurns: 50,
  startedAt: Date.now(),
  events: [],
  metrics: {} as Session["metrics"],
  pendingRequest: null,
  answeredRequests: new Map(),
  metaTicketId: null,
  systemPrompt: "You are ThinkRail, a spec-driven development agent…",
  promptSections: null,
  parentThinkrailSid: null,
  subsessionType: null,
  subsessionContext: null,
  returnStatus: null,
  returnSummary: null,
} satisfies Session;

// Seed the stores in `beforeEach` (runs right before THIS story renders) — NOT
// at module top-level. Other stories (StatusBar, ProgressTab, TicketProgressBar)
// also setState the session store at module load; whichever module Storybook
// evaluates last would win, wiping `story-draft` and blanking this card. Seeding
// per-render makes this story self-sufficient regardless of evaluation order.
function seedStores() {
  useSessionStore.setState({ sessions: new Map([[SID, session]]) });
  useSettingsStore.setState({ skills: FALLBACK_SKILLS, models: MODELS });
  useSpecStore.setState({ specs: [] });
  useBoardStore.setState({ tickets: new Map() });
  useUiStore.setState({ projectPath: "/mock/project" });
}

const meta = {
  title: "Chat/DraftConfigCard",
  component: DraftConfigCard,
  beforeEach: () => {
    seedStores();
  },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "DraftConfigCard is the pre-start session config: name, attachments, model / permission / turns / effort, a system-prompt preview, and Discard / Start Session.\n\n📍 **In the app:** at the top of the chat stream (Sessions tab) for a draft session, before you press Start Session." } },
  },
  args: { thinkrailSid: SID },
  decorators: [
    (Story) => (
      <RpcContext.Provider value={{} as RpcClient}>
        <div style={{ maxWidth: 720 }}>
          <Story />
        </div>
      </RpcContext.Provider>
    ),
  ],
} satisfies Meta<typeof DraftConfigCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {};
