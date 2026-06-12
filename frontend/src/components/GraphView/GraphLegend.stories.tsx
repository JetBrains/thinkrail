import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraphLegend } from "./GraphLegend";
import "./GraphView.css";

/**
 * GraphLegend is the static key for the spec graph: node-type colors (Goal /
 * Architecture / Module / Task) and edge styles (Parent / Depends / Reference).
 */
const meta = {
  title: "Graph/GraphLegend",
  component: GraphLegend,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "GraphLegend is the static key for the spec graph: node-type colors (Goal / Architecture / Module / Task) and edge styles (Parent / Depends / Reference).\n\n📍 **In the app:** the legend shown alongside the spec dependency graph (opened via the \"⬡ Graph\" button)." } },
  },
} satisfies Meta<typeof GraphLegend>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
