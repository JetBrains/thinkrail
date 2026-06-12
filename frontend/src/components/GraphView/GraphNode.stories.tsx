import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraphNode } from "./GraphNode";
import type { SpecEntry } from "@/types/spec.ts";
import "./GraphView.css";

/**
 * GraphNode is an SVG node in the spec graph: a rounded rect with a type-colored
 * left bar, an icon, and the (truncated) title. Color encodes spec type, the
 * border encodes status; selected nodes get a blue border. Rendered inside an
 * <svg> wrapper here.
 */
function spec(type: string, status: string, title: string): SpecEntry {
  return { id: title, type, status, title, path: "", covers: [], tags: [], created: "", updated: "" };
}

const meta = {
  title: "Graph/GraphNode",
  component: GraphNode,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "GraphNode is an SVG node in the spec graph: a rounded rect with a type-colored left bar, an icon, and the truncated title; color encodes spec type, border encodes status, selected nodes get a blue border.\n\n📍 **In the app:** each individual spec node inside the spec dependency graph (opened via the \"⬡ Graph\" button)." } },
  },
  args: {
    node: spec("module-design", "active", "Agent Runner"),
    x: 8,
    y: 8,
    selected: false,
    onClick: () => {},
    onDoubleClick: () => {},
  },
  argTypes: { onClick: { table: { disable: true } }, onDoubleClick: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <svg width={184} height={56} style={{ background: "var(--bg)" }}>
        <Story />
      </svg>
    ),
  ],
} satisfies Meta<typeof GraphNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Module: Story = {};
export const Selected: Story = { args: { selected: true } };
export const Goal: Story = { args: { node: spec("goal-and-requirements", "done", "Project Goal") } };
export const Architecture: Story = { args: { node: spec("architecture-design", "active", "System Architecture") } };
export const Task: Story = { args: { node: spec("task-spec", "stale", "Soft-delete trash") } };
