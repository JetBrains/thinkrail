// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FileText, ScrollText } from "lucide-react";

afterEach(cleanup);

import { TicketArtifactBar, type ArtifactEntry } from "@/components/TicketDetail/TicketArtifactBar.tsx";

const entries: ArtifactEntry[] = [
  { id: "pd", icon: <FileText size={12} strokeWidth={1.5} />, label: "product-design.md", live: false },
  { id: "td", icon: <FileText size={12} strokeWidth={1.5} />, label: "technical-design.md", live: false },
  { id: "plan", icon: <FileText size={12} strokeWidth={1.5} />, label: "implementation-plan.md", live: true },
  { id: "hist", icon: <ScrollText size={12} strokeWidth={1.5} />, label: "History", live: false },
];

describe("TicketArtifactBar — tabs mode", () => {
  it("renders one tab per entry", () => {
    render(
      <TicketArtifactBar
        entries={entries}
        selectedId="plan"
        onSelect={vi.fn()}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
      />,
    );
    expect(screen.getByText(/product-design\.md/)).toBeTruthy();
    expect(screen.getByText(/technical-design\.md/)).toBeTruthy();
    expect(screen.getByText(/implementation-plan\.md/)).toBeTruthy();
    expect(screen.getByText(/^History$/)).toBeTruthy();
  });

  it("clicking a tab fires onSelect", () => {
    const onSelect = vi.fn();
    render(
      <TicketArtifactBar
        entries={entries}
        selectedId="plan"
        onSelect={onSelect}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/product-design\.md/));
    expect(onSelect).toHaveBeenCalledWith("pd");
  });

  it("collapse toggle fires onToggleCollapsed(true)", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <TicketArtifactBar
        entries={entries}
        selectedId="plan"
        onSelect={vi.fn()}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
  });
});

describe("TicketArtifactBar — collapsed mode", () => {
  it("shows active entry + artifact count", () => {
    render(
      <TicketArtifactBar
        entries={entries}
        selectedId="plan"
        onSelect={vi.fn()}
        collapsed={true}
        onToggleCollapsed={vi.fn()}
      />,
    );
    expect(screen.getByText(/implementation-plan\.md/)).toBeTruthy();
    expect(screen.getByText(/4 artifacts/i)).toBeTruthy();
  });

  it("expand toggle fires onToggleCollapsed(false)", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <TicketArtifactBar
        entries={entries}
        selectedId="plan"
        onSelect={vi.fn()}
        collapsed={true}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    fireEvent.click(screen.getByTitle("Expand"));
    expect(onToggleCollapsed).toHaveBeenCalledWith(false);
  });

  it("dropdown opens; selecting fires onSelect", () => {
    const onSelect = vi.fn();
    render(
      <TicketArtifactBar
        entries={entries}
        selectedId="plan"
        onSelect={onSelect}
        collapsed={true}
        onToggleCollapsed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Show all artifacts"));
    fireEvent.click(screen.getByText(/product-design\.md/));
    expect(onSelect).toHaveBeenCalledWith("pd");
  });
});
