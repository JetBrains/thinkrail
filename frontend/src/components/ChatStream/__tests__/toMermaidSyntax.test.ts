import { describe, it, expect } from "vitest";
import { toMermaidSyntax } from "../VisualizationCard";
import type { StructuredDiagramData } from "@/types/vis";

describe("toMermaidSyntax", () => {
  it("produces valid mermaid flowchart with default top-to-bottom layout", () => {
    const data: StructuredDiagramData = {
      nodes: [
        { id: "a", label: "Module A" },
        { id: "b", label: "Module B" },
      ],
      edges: [{ from: "a", to: "b", label: "calls" }],
    };

    const result = toMermaidSyntax(data);
    expect(result).toContain("graph TD");
    expect(result).toContain('a["Module A"]');
    expect(result).toContain('b["Module B"]');
    expect(result).toContain('a -->|"calls"| b');
  });

  it("quotes edge labels so special chars like () don't break the parser", () => {
    const data: StructuredDiagramData = {
      nodes: [
        { id: "api", label: "API" },
        { id: "session", label: "Session" },
      ],
      edges: [{ from: "api", to: "session", label: "Depends()" }],
    };

    const result = toMermaidSyntax(data);
    expect(result).toContain('api -->|"Depends()"| session');
  });

  it("uses graph LR for left-to-right layout", () => {
    const data: StructuredDiagramData = {
      nodes: [{ id: "x", label: "X" }],
      edges: [],
      layout: "left-to-right",
    };

    const result = toMermaidSyntax(data);
    expect(result).toContain("graph LR");
  });

  it("uses graph TD for top-to-bottom layout", () => {
    const data: StructuredDiagramData = {
      nodes: [{ id: "x", label: "X" }],
      edges: [],
      layout: "top-to-bottom",
    };

    const result = toMermaidSyntax(data);
    expect(result).toContain("graph TD");
  });

  it("renders edges without labels correctly", () => {
    const data: StructuredDiagramData = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    };

    const result = toMermaidSyntax(data);
    expect(result).toContain("a --> b");
    expect(result).not.toContain("-->|");
  });

  it("escapes double quotes in labels", () => {
    const data: StructuredDiagramData = {
      nodes: [{ id: "a", label: 'Say "hello"' }],
      edges: [],
    };

    const result = toMermaidSyntax(data);
    expect(result).toContain('a["Say #quot;hello#quot;"]');
  });
});
