import type { Meta, StoryObj } from "@storybook/react-vite";
import { EdgeLayer } from "./EdgeLayer";
import type { SpecEntry } from "@/types/spec.ts";
import type { NodePosition } from "./graphLayout.ts";
import "./GraphView.css";

/**
 * EdgeLayer draws the connections between graph nodes as arrowed lines, styled
 * by edge type: parent = solid, depends-on = dashed, references = dotted.
 * It's an SVG <g>, so it's wrapped in an <svg> here.
 */
function node(id: string): SpecEntry {
  return { id, type: "module-design", status: "active", title: id, path: "", covers: [], tags: [], created: "", updated: "" };
}

const POSITIONS: NodePosition[] = [
  { node: node("a"), x: 150, y: 10 },
  { node: node("b"), x: 20, y: 120 },
  { node: node("c"), x: 280, y: 120 },
];

const EDGES = [
  { from: "a", to: "b", type: "parent" }, // solid
  { from: "a", to: "c", type: "depends-on" }, // dashed
  { from: "b", to: "c", type: "references" }, // dotted
];

const meta = {
  title: "Graph/EdgeLayer",
  component: EdgeLayer,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "EdgeLayer draws the connections between graph nodes as arrowed lines, styled by edge type: parent = solid, depends-on = dashed, references = dotted.\n\n📍 **In the app:** the edges drawn inside GraphCanvas in the spec dependency graph (opened via the \"⬡ Graph\" button)." } },
  },
  args: { edges: EDGES, positions: POSITIONS },
  decorators: [(Story) => <svg width={460} height={200} style={{ background: "var(--bg)" }}><Story /></svg>],
} satisfies Meta<typeof EdgeLayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EdgeStyles: Story = {};
