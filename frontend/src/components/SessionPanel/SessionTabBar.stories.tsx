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

const sampleSessions: Session[] = [
  {
    bonsaiSid: "sess-001",
    name: "Main session",
    status: "running",
    parentBonsaiSid: null,
    subsessionType: undefined,
    pendingRequests: [],
  } as Session,
  {
    bonsaiSid: "sess-002",
    name: "Bug fix",
    status: "done",
    parentBonsaiSid: null,
    subsessionType: undefined,
    pendingRequests: [],
  } as Session,
  {
    bonsaiSid: "sess-003",
    name: "Refinement",
    status: "running",
    parentBonsaiSid: "sess-001",
    subsessionType: "refinement",
    pendingRequests: [],
  } as Session,
  {
    bonsaiSid: "sess-004",
    name: "Discussion",
    status: "running",
    parentBonsaiSid: "sess-001",
    subsessionType: "discussion",
    pendingRequests: [],
  } as Session,
];

const sampleFiles: OpenFile[] = [
  { path: "/src/App.tsx", name: "App.tsx", isDirty: false },
  { path: "/src/index.tsx", name: "index.tsx", isDirty: true },
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
    previewFile: { path: "/src/utils/helper.ts", name: "helper.ts", isDirty: false },
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
      {
        bonsaiSid: "sess-001",
        name: "Main session",
        status: "running",
        parentBonsaiSid: null,
        subsessionType: undefined,
        pendingRequests: [],
      } as Session,
      {
        bonsaiSid: "sess-002",
        name: "Code refinement",
        status: "running",
        parentBonsaiSid: "sess-001",
        subsessionType: "refinement",
        pendingRequests: [],
      } as Session,
      {
        bonsaiSid: "sess-003",
        name: "Architecture discussion",
        status: "running",
        parentBonsaiSid: "sess-001",
        subsessionType: "discussion",
        pendingRequests: [],
      } as Session,
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
