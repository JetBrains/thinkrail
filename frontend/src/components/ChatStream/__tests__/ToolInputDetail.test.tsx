// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ToolInputDetail } from "../ToolInputDetail.tsx";
import {
  pipelineToVisData,
  shouldRenderToolInputDetail,
} from "../pipelineToolVisualization.ts";

const PIPELINE_INPUT = {
  nodes: [
    { id: "product-design", title: "Product design", skill: "ticket-product-design" },
    {
      id: "implementation",
      title: "Implementation",
      skill: "ticket-implement",
      executesPlan: true,
      dependsOn: ["product-design"],
    },
  ],
};

describe("ToolInputDetail propose_pipeline", () => {
  it("renders pipeline input as a visualization instead of raw nested JSON", () => {
    const { container } = render(
      <ToolInputDetail input={PIPELINE_INPUT} toolName="propose_pipeline" />,
    );

    expect(container.querySelector(".vis-card")).not.toBeNull();
    expect(container.querySelector(".tool-input-pipeline-list")).not.toBeNull();
    expect(container.textContent).toContain("Pipeline proposal");
    expect(container.textContent).toContain("Product design");
    expect(container.textContent).toContain("after product-design");
    expect(container.querySelector(".tool-input-value--nested")).toBeNull();
  });

  it("requests details rendering even when nodes is the only visible key", () => {
    expect(shouldRenderToolInputDetail("propose_pipeline", PIPELINE_INPUT)).toBe(true);
    expect(shouldRenderToolInputDetail("OtherTool", { value: ["a", "b"] })).toBe(false);
  });

  it("falls back to normal key-value rendering for malformed pipeline input", () => {
    const { container } = render(
      <ToolInputDetail
        toolName="propose_pipeline"
        input={{ nodes: "still streaming", reason: "draft" }}
      />,
    );

    expect(container.querySelector(".vis-card")).toBeNull();
    expect(container.querySelector(".tool-input-entries")).not.toBeNull();
    expect(container.textContent).toContain("nodes");
    expect(container.textContent).toContain("still streaming");
  });

  it("sanitizes mermaid node ids from stage ids", () => {
    const data = pipelineToVisData([
      {
        id: "product-design",
        title: "Product design",
        skill: "ticket-product-design",
        dependsOn: [],
      },
      {
        id: "implementation",
        title: "Implementation",
        skill: "ticket-implement",
        dependsOn: ["product-design"],
        executesPlan: true,
      },
    ]);

    expect(data.type).toBe("diagram");
    expect("diagram" in data.data ? data.data.diagram : "").toContain("n0_product_design");
    expect("diagram" in data.data ? data.data.diagram : "").toContain("n1_implementation");
    expect("diagram" in data.data ? data.data.diagram : "").toContain("n0_product_design --> n1_implementation");
  });
});
