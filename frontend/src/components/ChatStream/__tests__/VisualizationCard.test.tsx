// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { VisualizationCard } from "../VisualizationCard";
import type { VisData } from "@/types/vis";

const BASE_DATA: VisData = {
  type: "status-list",
  title: "Test",
  data: { items: [{ label: "Item", status: "done" }] },
};

describe("VisualizationCard layout hints", () => {
  it("applies vis-card--compact class for compact width", () => {
    const data: VisData = { ...BASE_DATA, layout: { width: "compact" } };
    const { container } = render(<VisualizationCard data={data} />);
    const card = container.querySelector(".vis-card");
    expect(card?.className).toContain("vis-card--compact");
  });

  it("applies vis-card--wide class for wide width", () => {
    const data: VisData = { ...BASE_DATA, layout: { width: "wide" } };
    const { container } = render(<VisualizationCard data={data} />);
    const card = container.querySelector(".vis-card");
    expect(card?.className).toContain("vis-card--wide");
  });

  it("does not apply width class for normal width", () => {
    const data: VisData = { ...BASE_DATA, layout: { width: "normal" } };
    const { container } = render(<VisualizationCard data={data} />);
    const card = container.querySelector(".vis-card");
    expect(card?.className).not.toContain("vis-card--compact");
    expect(card?.className).not.toContain("vis-card--wide");
  });

  it("sets maxHeight inline style on body", () => {
    const data: VisData = { ...BASE_DATA, layout: { maxHeight: 200 } };
    const { container } = render(<VisualizationCard data={data} />);
    const body = container.querySelector(".vis-card-body") as HTMLElement;
    expect(body.style.maxHeight).toBe("200px");
    expect(body.style.overflowY).toBe("auto");
  });

  it("does not set maxHeight when not provided", () => {
    const { container } = render(<VisualizationCard data={BASE_DATA} />);
    const body = container.querySelector(".vis-card-body") as HTMLElement;
    expect(body.style.maxHeight).toBe("");
  });
});

describe("Diagram with notation=mermaid", () => {
  it("does not render pre.vis-diagram-text when notation is mermaid", () => {
    const data: VisData = {
      type: "diagram",
      title: "Mermaid Test",
      data: { diagram: "graph LR\n  A --> B", notation: "mermaid" },
    };
    const { container } = render(<VisualizationCard data={data} />);
    // Should NOT render a <pre> text block — MermaidDiagram renders instead
    expect(container.querySelector(".vis-diagram-text")).toBeNull();
    // Should still have the diagram wrapper
    expect(container.querySelector(".vis-diagram")).not.toBeNull();
  });

  it("renders pre.vis-diagram-text for plain text diagrams", () => {
    const data: VisData = {
      type: "diagram",
      title: "Text Test",
      data: { diagram: "A --> B --> C" },
    };
    const { container } = render(<VisualizationCard data={data} />);
    expect(container.querySelector(".vis-diagram-text")).not.toBeNull();
  });
});

describe("Comparison with visualization field", () => {
  it("renders vis-comparison-diagram when visualization is provided", () => {
    const data: VisData = {
      type: "comparison",
      title: "Compare",
      data: {
        options: [
          {
            name: "Option A",
            visualization: "graph TD\n  A --> B",
            pros: ["fast"],
          },
        ],
      },
    };
    const { container } = render(<VisualizationCard data={data} />);
    expect(container.querySelector(".vis-comparison-diagram")).not.toBeNull();
  });

  it("does not render vis-comparison-diagram when visualization is absent", () => {
    const data: VisData = {
      type: "comparison",
      title: "Compare",
      data: {
        options: [{ name: "Option A", pros: ["fast"] }],
      },
    };
    const { container } = render(<VisualizationCard data={data} />);
    expect(container.querySelector(".vis-comparison-diagram")).toBeNull();
  });
});
