import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionTabBar } from "./SessionTabBar";
import type { Session } from "@/types/session";
import type { OpenFile } from "@/store/fileStore";
import "@/components/ChatStream/ChatStream.css";

/**
 * SessionTabBar displays session tabs, file tabs, and a preview tab in a
 * horizontal bar. Sessions are hierarchically ordered (roots first, children
 * indented). Files are pinned, preview is ephemeral (italic, double-click to
 * pin). Each tab shows status indicator and close button.
 *
 * Used at the top of the SessionPanel to switch between open sessions and files.
 */

function makeSession(overrides: Partial<Session>): Session {
  return {
    thinkrailSid: "sess-000",
    name: "Session",
    skillId: null,
    specIds: [],
    filePaths: [],
    status: "running",
    model: "claude-sonnet-4-5",
    permissionMode: "default",
    effort: "medium",
    startedAt: Date.now(),
    events: [],
    metrics: {
      costUsd: 0,
      turns: 0,
      toolCalls: 0,
      contextTokens: 0,
      contextMax: 0,
      durationMs: 0,
      filesChanged: {},
      contextUsage: {
        contextMax: 0,
        contextTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        inputTokens: 0,
        turnHistory: [],
        runBoundaries: [],
        toolCallCounts: {},
        toolTokens: {},
        filesRead: [],
        filesWritten: [],
      },
    },
    pendingRequests: [],
    answeredRequests: new Map(),
    parentThinkrailSid: null,
    subsessionType: null,
    subsessionContext: null,
    returnStatus: null,
    returnSummary: null,
    artifacts: [],
    previewPath: null,
    previewSection: null,
    ...overrides,
  };
}

function makeFile(overrides: Partial<OpenFile> & Pick<OpenFile, "path" | "name">): OpenFile {
  return {
    content: "",
    originalContent: "",
    mode: "preview",
    isDirty: false,
    saving: false,
    ...overrides,
  };
}

const sampleSessions: Session[] = [
  makeSession({ thinkrailSid: "sess-001", name: "Main session", status: "running" }),
  makeSession({ thinkrailSid: "sess-002", name: "Bug fix", status: "done" }),
  makeSession({
    thinkrailSid: "sess-003",
    name: "Refinement",
    status: "running",
    parentThinkrailSid: "sess-001",
    subsessionType: "refinement",
  }),
  makeSession({
    thinkrailSid: "sess-004",
    name: "Discussion",
    status: "running",
    parentThinkrailSid: "sess-001",
    subsessionType: "discussion",
  }),
];

const sampleFiles: OpenFile[] = [
  makeFile({ path: "/src/App.tsx", name: "App.tsx", isDirty: false }),
  makeFile({ path: "/src/index.tsx", name: "index.tsx", isDirty: true }),
];

const sampleTickets = [
  { id: "ticket-001", title: "Add user authentication" },
  { id: "ticket-002", title: "Fix navigation bug" },
];

const meta = {
  title: "SessionPanel/SessionTabBar",
  component: SessionTabBar,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Displays session tabs, file tabs, and a preview tab in a horizontal bar. Sessions are hierarchically ordered (roots first, children indented). Files are pinned, preview is ephemeral (italic, double-click to pin). Each tab shows status indicator and close button.\n\n📍 **In the app:** top of the SessionPanel (the main chat view) to switch between open sessions and files.",
      },
    },
  },
  args: {
    tickets: [],
    activeTicketId: null,
    onSwitchTicket: () => {},
    onCloseTicket: () => {},
    sessions: sampleSessions,
    activeSessionId: "sess-001",
    onSwitchSession: () => {},
    onCloseSession: () => {},
    files: sampleFiles,
    activeFilePath: null,
    onSwitchFile: () => {},
    onCloseFile: () => {},
    previewFile: null,
    previewFilePath: null,
    onClearPreview: () => {},
    onPinPreview: () => {},
  },
  argTypes: {
    onSwitchTicket: { table: { disable: true } },
    onCloseTicket: { table: { disable: true } },
    onSwitchSession: { table: { disable: true } },
    onCloseSession: { table: { disable: true } },
    onSwitchFile: { table: { disable: true } },
    onCloseFile: { table: { disable: true } },
    onClearPreview: { table: { disable: true } },
    onPinPreview: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div style={{ width: "100%", background: "var(--bg)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionTabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPendingQuestion: Story = {
  args: {
    sessions: [
      {
        ...sampleSessions[0],
        pendingRequests: [{ type: "question" }] as Session["pendingRequests"],
      },
      ...sampleSessions.slice(1),
    ],
  },
};

export const WithPendingApproval: Story = {
  args: {
    sessions: [
      {
        ...sampleSessions[0],
        pendingRequests: [{ type: "approval" }] as Session["pendingRequests"],
      },
      ...sampleSessions.slice(1),
    ],
  },
};

export const FileTabActive: Story = {
  args: {
    activeSessionId: null,
    activeFilePath: "/src/App.tsx",
  },
};

export const WithPreview: Story = {
  args: {
    previewFile: makeFile({ path: "/src/utils/helper.ts", name: "helper.ts", isDirty: false }),
    previewFilePath: "/src/utils/helper.ts",
  },
};

export const SessionsOnly: Story = {
  args: {
    files: [],
  },
};

export const FilesOnly: Story = {
  args: {
    sessions: [],
    activeSessionId: null,
    activeFilePath: "/src/App.tsx",
  },
};

export const WithSubsessionTypes: Story = {
  args: {
    sessions: [
      makeSession({ thinkrailSid: "sess-001", name: "Main session", status: "running" }),
      makeSession({
        thinkrailSid: "sess-002",
        name: "Code refinement",
        status: "running",
        parentThinkrailSid: "sess-001",
        subsessionType: "refinement",
      }),
      makeSession({
        thinkrailSid: "sess-003",
        name: "Architecture discussion",
        status: "running",
        parentThinkrailSid: "sess-001",
        subsessionType: "discussion",
      }),
    ],
    activeSessionId: "sess-002",
    files: [],
  },
};

export const WithTickets: Story = {
  args: {
    tickets: sampleTickets,
    activeTicketId: "ticket-001",
  },
};
