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
vi.mock("../TicketPlanView.tsx", () => ({
  TicketPlanView: () => <div data-testid="plan-view">Plan</div>,
}));
vi.mock("../TicketHistoryView.tsx", () => ({
  TicketHistoryView: () => <div data-testid="history-view">History</div>,
}));
vi.mock("../TicketFileView.tsx", () => ({
  TicketFileView: ({ filePath }: { filePath: string }) => (
    <div data-testid="file-view">{filePath}</div>
  ),
}));

import { TicketPreviewPanel } from "@/components/TicketDetail/TicketPreviewPanel.tsx";
import type { Ticket } from "@/types/board.ts";

const ticket: Ticket = {
  id: "t1",
  title: "x",
  status: "implementing",
  productDesignPath: "pd.md",
  technicalDesignPath: null,
  historyPath: null,
  implementationPlanPath: "impl.md",
  skippedPhases: [],
} as unknown as Ticket;

describe("TicketPreviewPanel", () => {
  it("renders artifact bar with derived entries", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        plan={null}
        historyEntries={[]}
        sessionTouchedFiles={[]}
        onPlanUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText(/product-design\.md/i)).toBeTruthy();
    expect(screen.getByText(/implementation-plan\.md/i)).toBeTruthy();
  });

  it("default selection prefers canonical artifact for current phase", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        plan={null}
        historyEntries={[]}
        sessionTouchedFiles={[]}
        onPlanUpdated={vi.fn()}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeTruthy();
  });

  it("clicking a tab updates the active preview", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        plan={null}
        historyEntries={[]}
        sessionTouchedFiles={[]}
        onPlanUpdated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/product-design\.md/i));
    expect(screen.getByTestId("art-view").textContent).toBe("product_design");
  });

  it("history entry renders history view", () => {
    render(
      <TicketPreviewPanel
        ticket={ticket}
        plan={null}
        historyEntries={[{}, {}]}
        sessionTouchedFiles={[]}
        onPlanUpdated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/^History$/));
    expect(screen.getByTestId("history-view")).toBeTruthy();
  });
});
