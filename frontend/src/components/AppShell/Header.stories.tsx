import type { Meta, StoryObj } from "@storybook/react-vite";
import { Header } from "./Header";
import { useUiStore } from "@/store/uiStore";
import { useSessionStore } from "@/store/sessionStore";
import { useBoardStore } from "@/store/boardStore";
import { useConnectionStore } from "@/store/connectionStore";
import { restClient } from "@/api/rest.ts";
import { PRODUCT_NAME } from "@/constants/branding";
import "./AppShell.css";

/**
 * Header is the main navigation bar across the top of the app. It contains the
 * product logo, project selector dropdown (shows recent projects), Board/Ticket tabs
 * with icons, and an ellipsis menu for accessing Files & Specs and Dashboard.
 */
const MOCK_PROJECTS = [
  { path: "/Users/you/src/thinkrail", name: "thinkrail", registered_at: "", last_opened_at: "" },
  { path: "/Users/you/src/inventory-service", name: "inventory-service", registered_at: "", last_opened_at: "" },
  { path: "/Users/you/src/api-gateway", name: "api-gateway", registered_at: "", last_opened_at: "" },
];

const meta = {
  title: "Layout/Header",
  component: Header,
  beforeEach: () => {
    useUiStore.setState({
      projectName: "my-project",
      centerView: "sessions",
      leftPanelCollapsed: false,
      leftActiveTab: "sessions",
    });
    useSessionStore.setState({ sessions: new Map() });
    useBoardStore.setState({ tickets: new Map() });
    useConnectionStore.setState({ clients: [] });

    const realGET = restClient.GET.bind(restClient);
    restClient.GET = ((url: string, opts: unknown) => {
      if (url === "/api/projects/known") return Promise.resolve({ data: MOCK_PROJECTS, error: undefined });
      if (url === "/api/project/validate") {
        const params = (opts as any)?.params?.query;
        const path = params?.path;
        return Promise.resolve({ data: { exists: true, path }, error: undefined });
      }
      return (realGET as (u: string, o: unknown) => unknown)(url, opts);
    }) as unknown as typeof restClient.GET;
    return () => { restClient.GET = realGET; };
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          `The main navigation bar across the top of the app. Contains the ${PRODUCT_NAME} logo, project selector, Board/Ticket view tabs with icons, ellipsis menu (Files & Specs, Dashboard), and settings button.\n\n📍 **In the app:** always visible at the top of AppShell.`,
      },
    },
  },
  args: {
    onSwitchProject: () => {},
  },
  argTypes: {
    onSwitchProject: { table: { disable: true } },
  },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BoardView: Story = {
  beforeEach: () => {
    useUiStore.setState({
      projectName: "inventory-service",
      centerView: "board",
      leftPanelCollapsed: false,
      leftActiveTab: "specs",
    });
    useBoardStore.setState({
      tickets: new Map([
        ["t1", { id: "t1", title: "Task 1" } as any],
        ["t2", { id: "t2", title: "Task 2" } as any],
        ["t3", { id: "t3", title: "Task 3" } as any],
      ]),
    });
  },
};

export const WithActiveSessions: Story = {
  beforeEach: () => {
    useUiStore.setState({
      projectName: "api-gateway",
      centerView: "sessions",
      leftPanelCollapsed: false,
      leftActiveTab: "sessions",
    });
    useSessionStore.setState({
      sessions: new Map([
        [
          "s1",
          {
            thinkrailSid: "s1",
            name: "Investigation",
            status: "running",
          } as any,
        ],
        [
          "s2",
          {
            thinkrailSid: "s2",
            name: "Architecture design",
            status: "running",
          } as any,
        ],
      ]),
    });
  },
};

export const WithMultipleClients: Story = {
  beforeEach: () => {
    useUiStore.setState({
      projectName: "collaborative-app",
      centerView: "sessions",
    });
    useConnectionStore.setState({
      clients: [
        { displayName: "Alice" } as any,
        { displayName: "Bob" } as any,
        { displayName: "Charlie" } as any,
      ],
    });
  },
};

export const WizardVariant: Story = {
  args: {
    variant: "wizard",
    wizardSteps: [
      { label: "Describe project", status: "done", icon: "grid-2x2-plus" },
      { label: "Define goals", status: "done", icon: "target" },
      { label: "Goals ready", status: "active", icon: "book-check" },
      { label: "Define architecture", status: "pending", icon: "pencil-ruler" },
      { label: "Architecture ready", status: "pending", icon: "pencil-ruler" },
    ],
  },
  beforeEach: () => {
    useUiStore.setState({
      projectName: "new-project",
      centerView: "sessions",
    });
  },
  parameters: {
    docs: {
      description: {
        story:
          "Wizard variant with a known project. Shows the logo, project selector dropdown, centered wizard steps, and settings button.",
      },
    },
  },
};

export const WizardVariantNoProject: Story = {
  args: {
    variant: "wizard",
    wizardSteps: [
      { label: "Describe project", status: "active", icon: "grid-2x2-plus" },
      { label: "Define goals", status: "pending", icon: "target" },
      { label: "Goals ready", status: "pending", icon: "book-check" },
      { label: "Define architecture", status: "pending", icon: "pencil-ruler" },
      { label: "Architecture ready", status: "pending", icon: "pencil-ruler" },
    ],
  },
  beforeEach: () => {
    useUiStore.setState({
      projectName: "",
      centerView: "sessions",
    });
  },
  parameters: {
    docs: {
      description: {
        story:
          "Wizard variant without a project. Shows only the logo, centered wizard steps, and settings button.",
      },
    },
  },
};
