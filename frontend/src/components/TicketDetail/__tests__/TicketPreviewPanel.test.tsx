// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

vi.mock("@/store/uiStore.ts", () => ({
  useUiStore: (selector: (s: any) => any) =>
    selector({
      ticketArtifactBarCollapsed: false,
      setTicketArtifactBarCollapsed: vi.fn(),
      projectPath: "/proj",
    }),
}));
vi.mock("../TicketArtifactView.tsx", () => ({
  TicketArtifactView: ({ kind }: { kind: string }) => (
    <div data-testid="art-view">{kind}</div>
  ),
}));
vi.mock("../TicketHistoryView.tsx", () => ({
  TicketHistoryView: () => <div data-testid="history-view">History</div>,
}));
vi.mock("@/components/ContextPanel/PreviewBody.tsx", () => ({
  PreviewBody: ({ path }: { path: string }) => (
    <div data-testid="file-view">{path}</div>
  ),
}));

import { TicketPreviewPanel } from "@/components/TicketDetail/TicketPreviewPanel.tsx";
import type { Ticket } from "@/types/board.ts";

// Stages with a running plan-executing node → lifecycle derives to
// "implementation", so the plan is the default artifact.
const ticket: Ticket = {
  id: "t1",
  title: "x",
  stages: [
    { id: "impl", title: "Implement", executesPlan: true, status: "running" },
  ],
  productDesignPath: "pd.md",
  technicalDesignPath: null,
  historyPath: null,
  implementationPlanPath: "impl.md",
} as unknown as Ticket;

describe("TicketPreviewPanel", () => {
  it("renders artifact bar with derived entries", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        historyEntries={[]}
        sessionTouchedFiles={[]}
      />,
    );
    expect(screen.getByText(/product-design\.md/i)).toBeTruthy();
    expect(screen.getByText(/implementation-plan\.md/i)).toBeTruthy();
  });

  it("default selection prefers the plan when in implementation", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        historyEntries={[]}
        sessionTouchedFiles={[]}
      />,
    );
    expect(screen.getByTestId("art-view").textContent).toBe("implementation_plan");
  });

  it("clicking a tab updates the active preview", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        historyEntries={[]}
        sessionTouchedFiles={[]}
      />,
    );
    fireEvent.click(screen.getByText(/product-design\.md/i));
    expect(screen.getByTestId("art-view").textContent).toBe("product_design");
  });

  it("history entry renders history view", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        historyEntries={[{}, {}]}
        sessionTouchedFiles={[]}
      />,
    );
    fireEvent.click(screen.getByText(/^History$/));
    expect(screen.getByTestId("history-view")).toBeTruthy();
  });
});
