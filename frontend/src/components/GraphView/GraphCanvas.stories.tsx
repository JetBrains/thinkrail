import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraphCanvas } from "./GraphCanvas";
import type { SpecEntry } from "@/types/spec.ts";
import type { NodePosition } from "./graphLayout.ts";
import "./GraphView.css";

/**
 * GraphCanvas is the full spec-graph SVG: it lays out GraphNodes at given
 * positions, draws the EdgeLayer between them, and applies a pan/zoom transform.
 */
function node(id: string, type: string, status: string, title: string): SpecEntry {
  return { id, type, status, title, path: "", covers: [], tags: [], created: "", updated: "" };
}

const POSITIONS: NodePosition[] = [
  { node: node("arch", "architecture-design", "active", "Architecture"), x: 150, y: 10 },
  { node: node("agent", "module-design", "active", "Agent Runner"), x: 20, y: 110 },
  { node: node("spec-index", "module-design", "done", "Spec Index"), x: 280, y: 110 },
  { node: node("task", "task-spec", "active", "Runner loop"), x: 150, y: 210 },
];

const EDGES = [
  { from: "arch", to: "agent", type: "parent" },
  { from: "arch", to: "spec-index", type: "parent" },
  { from: "agent", to: "task", type: "depends-on" },
  { from: "spec-index", to: "task", type: "references" },
];

const meta = {
  title: "Graph/GraphCanvas",
  component: GraphCanvas,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "GraphCanvas is the full spec-graph SVG: it lays out GraphNodes at given positions, draws the EdgeLayer between them, and applies a pan/zoom transform.\n\n📍 **In the app:** the whole spec dependency graph canvas (nodes, edges, pan/zoom), opened via the \"⬡ Graph\" button in the left panel." } },
  },
  args: {
    positions: POSITIONS,
    edges: EDGES,
    selectedId: "agent",
    transform: { translateX: 10, translateY: 10, scale: 1 },
    onNodeClick: () => {},
    onNodeDoubleClick: () => {},
  },
  argTypes: { onNodeClick: { table: { disable: true } }, onNodeDoubleClick: { table: { disable: true } } },
  decorators: [(Story) => <div style={{ width: 480, height: 300, background: "var(--bg)" }}><Story /></div>],
} satisfies Meta<typeof GraphCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ZoomedOut: Story = { args: { transform: { translateX: 40, translateY: 20, scale: 0.7 } } };
