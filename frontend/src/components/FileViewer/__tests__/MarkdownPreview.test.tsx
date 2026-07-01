// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownPreview } from "../MarkdownPreview";

describe("MarkdownPreview mermaid rendering", () => {
  const content = "```mermaid\ngraph LR\n  A --> B\n```\n";

  it("renders mermaid fences via the shared MermaidDiagram (chat) component", () => {
    const { container } = render(<MarkdownPreview content={content} />);
    // Shared, click-to-expand chat component
    expect(container.querySelector(".vis-mermaid-wrapper")).not.toBeNull();
    expect(container.querySelector(".vis-mermaid-expandable")).not.toBeNull();
  });

  it("no longer renders the old md-mermaid duplicate UI", () => {
    const { container } = render(<MarkdownPreview content={content} />);
    expect(container.querySelector(".md-mermaid-wrapper")).toBeNull();
    expect(container.querySelector(".md-mermaid-zoom")).toBeNull();
  });
});
