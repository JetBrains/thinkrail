import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FileSelector } from "./FileSelector";
import { useUiStore } from "@/store/uiStore.ts";
import { restClient } from "@/api/rest.ts";

/**
 * FileSelector is a searchable, collapsible file tree for picking project files.
 * Unlike the other selectors it doesn't read a store — it fetches the tree from
 * the backend (GET /api/project/files) for the active project path.
 *
 * To document it without a running backend, the story seeds a project path and
 * overrides restClient.GET for that one endpoint (returning a mock tree).
 * (We override the client rather than window.fetch because openapi-fetch
 * snapshots fetch at import time, before this module runs.)
 * Directories start collapsed; click to expand, or search to filter files.
 */
interface MockEntry {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

const MOCK_ENTRIES: MockEntry[] = [
  { path: "backend", name: "backend", isDir: true, depth: 0 },
  { path: "backend/app", name: "app", isDir: true, depth: 1 },
  { path: "backend/app/main.py", name: "main.py", isDir: false, depth: 2 },
  { path: "backend/app/cli.py", name: "cli.py", isDir: false, depth: 2 },
  { path: "frontend", name: "frontend", isDir: true, depth: 0 },
  { path: "frontend/src", name: "src", isDir: true, depth: 1 },
  { path: "frontend/src/main.tsx", name: "main.tsx", isDir: false, depth: 2 },
  { path: "README.md", name: "README.md", isDir: false, depth: 0 },
  { path: "run.sh", name: "run.sh", isDir: false, depth: 0 },
];

// Seed + stub in `beforeEach` (scoped to THIS story's render, with cleanup)
// rather than at module load — module-level restClient.GET reassignment from
// different stories chains/clobbers depending on import & HMR order.
// beforeEach keeps each story self-contained.
const meta = {
  title: "Pickers/FileSelector",
  component: FileSelector,
  beforeEach: () => {
    useUiStore.setState({ projectPath: "/mock/project" });
    const realGET = restClient.GET.bind(restClient);
    restClient.GET = ((url: string, opts: unknown) => {
      if (url === "/api/project/files") {
        return Promise.resolve({ data: { entries: MOCK_ENTRIES }, error: undefined });
      }
      return (realGET as (u: string, o: unknown) => unknown)(url, opts);
    }) as unknown as typeof restClient.GET;
    return () => { restClient.GET = realGET; };
  },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "FileSelector is a searchable, collapsible file tree for picking project files; it fetches the tree from the backend for the active project path.\n\n📍 **In the app:** in the draft session config card's \"+ attach file\" popover (`DraftConfigCard`)." } },
  },
  args: { selectedPaths: [], onToggle: () => {} },
} satisfies Meta<typeof FileSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

function FileSelectorDemo() {
  const [selectedPaths, setSelectedPaths] = useState<string[]>(["backend/app/main.py"]);
  const toggle = (path: string) =>
    setSelectedPaths((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]));
  return (
    <div style={{ maxWidth: 360, height: 360 }}>
      <FileSelector selectedPaths={selectedPaths} onToggle={toggle} />
    </div>
  );
}

export const Default: Story = {
  render: () => <FileSelectorDemo />,
};
