import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProjectDropdown } from "./ProjectDropdown";
import { restClient } from "@/api/rest.ts";

/**
 * ProjectDropdown displays a list of recent projects. Click a project to open it.
 * Used in the Header component's project selector.
 */
const MOCK_PROJECTS = [
  { path: "/Users/you/src/thinkrail", name: "thinkrail", registered_at: "", last_opened_at: "" },
  { path: "/Users/you/src/inventory-service", name: "inventory-service", registered_at: "", last_opened_at: "" },
  { path: "/Users/you/src/api-gateway", name: "api-gateway", registered_at: "", last_opened_at: "" },
];

const meta = {
  title: "Pickers/ProjectDropdown",
  component: ProjectDropdown,
  beforeEach: () => {
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
    layout: "padded",
    docs: {
      description: {
        component:
          "ProjectDropdown displays a list of recent projects with project name and path. Click a project to select it.\n\n📍 **In the app:** shown when clicking the project selector in the Header.",
      },
    },
  },
  args: {
    onSelectProject: () => {},
    onClose: () => {},
  },
  argTypes: {
    onSelectProject: { table: { disable: true } },
    onClose: { table: { disable: true } },
  },
  decorators: [(Story) => <div style={{ position: "relative", minHeight: 280 }}><Story /></div>],
} satisfies Meta<typeof ProjectDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default state with three recent projects. */
export const Default: Story = {};

/** Empty state when there are no recent projects. */
export const Empty: Story = {
  beforeEach: () => {
    const realGET = restClient.GET.bind(restClient);
    restClient.GET = ((url: string, opts: unknown) => {
      if (url === "/api/projects/known") return Promise.resolve({ data: [], error: undefined });
      return (realGET as (u: string, o: unknown) => unknown)(url, opts);
    }) as unknown as typeof restClient.GET;
    return () => { restClient.GET = realGET; };
  },
};

/** Single project in the list. */
export const SingleProject: Story = {
  beforeEach: () => {
    const realGET = restClient.GET.bind(restClient);
    restClient.GET = ((url: string, opts: unknown) => {
      if (url === "/api/projects/known") {
        return Promise.resolve({
          data: [{ path: "/Users/you/src/thinkrail", name: "thinkrail", registered_at: "", last_opened_at: "" }],
          error: undefined,
        });
      }
      if (url === "/api/project/validate") {
        const params = (opts as any)?.params?.query;
        const path = params?.path;
        return Promise.resolve({ data: { exists: true, path }, error: undefined });
      }
      return (realGET as (u: string, o: unknown) => unknown)(url, opts);
    }) as unknown as typeof restClient.GET;
    return () => { restClient.GET = realGET; };
  },
};

/** Many projects (tests scrolling). */
export const ManyProjects: Story = {
  beforeEach: () => {
    const manyProjects = [
      { path: "/Users/you/src/thinkrail", name: "thinkrail", registered_at: "", last_opened_at: "" },
      { path: "/Users/you/src/inventory-service", name: "inventory-service", registered_at: "", last_opened_at: "" },
      { path: "/Users/you/src/api-gateway", name: "api-gateway", registered_at: "", last_opened_at: "" },
      { path: "/Users/you/src/auth-service", name: "auth-service", registered_at: "", last_opened_at: "" },
      { path: "/Users/you/src/payment-processor", name: "payment-processor", registered_at: "", last_opened_at: "" },
      { path: "/Users/you/src/notification-service", name: "notification-service", registered_at: "", last_opened_at: "" },
      { path: "/Users/you/src/analytics-dashboard", name: "analytics-dashboard", registered_at: "", last_opened_at: "" },
    ];
    const realGET = restClient.GET.bind(restClient);
    restClient.GET = ((url: string, opts: unknown) => {
      if (url === "/api/projects/known") return Promise.resolve({ data: manyProjects, error: undefined });
      if (url === "/api/project/validate") {
        const params = (opts as any)?.params?.query;
        const path = params?.path;
        return Promise.resolve({ data: { exists: true, path }, error: undefined });
      }
      return (realGET as (u: string, o: unknown) => unknown)(url, opts);
    }) as unknown as typeof restClient.GET;
    return () => { restClient.GET = realGET; };
  },
};
