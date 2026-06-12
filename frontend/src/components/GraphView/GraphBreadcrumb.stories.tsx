import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraphBreadcrumb } from "./GraphBreadcrumb";
import type { SpecEntry } from "@/types/spec.ts";
import "./GraphView.css";

/**
 * GraphBreadcrumb shows the drill-down trail in the spec graph, with a back
 * button, clickable ancestors, and the current node. Hidden when the trail is
 * empty.
 */
function spec(id: string, title: string): SpecEntry {
  return { id, title, type: "module", status: "active", path: "", covers: [], tags: [], created: "", updated: "" };
}

const meta = {
  title: "Graph/GraphBreadcrumb",
  component: GraphBreadcrumb,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "GraphBreadcrumb shows the drill-down trail in the spec graph, with a back button, clickable ancestors, and the current node.\n\n📍 **In the app:** the path breadcrumb above the spec dependency graph (opened via the \"⬡ Graph\" button), shown when you've drilled into a node." } },
  },
  args: {
    trail: [spec("arch", "Architecture"), spec("agent", "Agent module"), spec("runner", "Agent Runner")],
    onNavigate: () => {},
  },
  argTypes: { onNavigate: { table: { disable: true } } },
} satisfies Meta<typeof GraphBreadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeLevels: Story = {};
export const SingleLevel: Story = { args: { trail: [spec("arch", "Architecture")] } };
