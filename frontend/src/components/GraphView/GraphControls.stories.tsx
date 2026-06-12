import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraphControls } from "./GraphControls";
import "./GraphView.css";

/**
 * GraphControls is the zoom toolbar for the spec graph: zoom in / out, current
 * zoom %, and fit-to-view.
 */
const meta = {
  title: "Graph/GraphControls",
  component: GraphControls,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "GraphControls is the zoom toolbar for the spec graph: zoom in / out, current zoom %, and fit-to-view.\n\n📍 **In the app:** the zoom/fit controls overlaid on the spec dependency graph (opened via the \"⬡ Graph\" button)." } },
  },
  args: { zoom: 1, onZoomIn: () => {}, onZoomOut: () => {}, onFit: () => {} },
  argTypes: {
    zoom: { control: { type: "range", min: 0.25, max: 3, step: 0.25 } },
    onZoomIn: { table: { disable: true } },
    onZoomOut: { table: { disable: true } },
    onFit: { table: { disable: true } },
  },
} satisfies Meta<typeof GraphControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ZoomedIn: Story = { args: { zoom: 1.75 } };
export const ZoomedOut: Story = { args: { zoom: 0.5 } };
