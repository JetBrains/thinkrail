// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

import { TicketPhaseList } from "../TicketPhaseList";
import { useBoardStore } from "@/store/boardStore";
import { useSessionStore } from "@/store/sessionStore";
import type { Ticket } from "@/types/board";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "mt_test",
    title: "Test",
    body: "",
    status: "product-design",
    type: "feature",
    productDesignPath: null,
    technicalDesignPath: null,
    historyPath: null,
    implementationPlanPath: null,
    technicalDesignStale: false,
    historyStale: false,
    implementationPlanStale: false,
    orchestratorSessionId: null,
    linkedSpecIds: [],
    sessionIds: [],
    order: 0,
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    skippedPhases: [],
    ...overrides,
  };
}

const skipPhaseMock = vi.fn();
const unskipPhaseMock = vi.fn();
const updateTicketMock = vi.fn();

beforeEach(() => {
  skipPhaseMock.mockReset();
  unskipPhaseMock.mockReset();
  updateTicketMock.mockReset();
  useBoardStore.setState({
    skipPhase: skipPhaseMock,
    unskipPhase: unskipPhaseMock,
    updateTicket: updateTicketMock,
  } as unknown as ReturnType<typeof useBoardStore.getState>);
  useSessionStore.setState({
    sessions: new Map(),
  } as unknown as ReturnType<typeof useSessionStore.getState>);
});

describe("TicketPhaseList", () => {
  it("renders all seven phase rows", () => {
    render(
      <TicketPhaseList
        ticket={makeTicket()}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    for (const label of [
      "Idea",
      "Product design",
      "Technical design",
      "Amend specs",
      "Implementation plan",
      "Implementing",
      "Done",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("status=amend-specs: amend-specs row is current with ▶ Run", () => {
    const onStartSession = vi.fn();
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "amend-specs" })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={onStartSession}
        onSelectPanel={vi.fn()}
      />,
    );
    // Status === ongoing work: amend-specs is the current phase.
    const asRow = screen.getByText("Amend specs").closest(".tpl-row")!;
    expect(asRow.className).toContain("tpl-row--current");
    const cta = asRow.querySelector("[title='Run with AI']") as HTMLButtonElement;
    expect(cta).not.toBeNull();
    fireEvent.click(cta);
    expect(onStartSession).toHaveBeenCalledWith("ticket-amend-specs");
  });

  it("clicking Skip on the current row calls skipPhase", () => {
    render(
      <TicketPhaseList
        // Status === ongoing work: status="product-design" makes
        // product-design the current row, where the Skip icon sits.
        ticket={makeTicket({ status: "product-design" })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    const row = screen.getByText("Product design").closest(".tpl-row")!;
    const skipBtn = row.querySelector("[title='Skip']") as HTMLButtonElement;
    fireEvent.click(skipBtn);
    expect(skipPhaseMock).toHaveBeenCalledWith("mt_test", "product-design");
  });

  it("clicking Back on a skipped row calls unskipPhase only (no session start)", async () => {
    const onStartSession = vi.fn();
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "amend-specs", sessionIds: ["td_sid"], skippedPhases: ["technical-design"] })}
        plan={null}
        phaseSessionIds={{ "technical-design": "td_sid" }}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={onStartSession}
        onSelectPanel={vi.fn()}
      />,
    );
    const skippedRow = screen.getByText("Technical design").closest(".tpl-row")!;
    expect(skippedRow.className).toContain("tpl-row--skipped");
    const backBtn = skippedRow.querySelector(".tpl-icon-btn--refine, .tpl-icon-btn--back") as HTMLButtonElement;
    expect(backBtn).not.toBeNull();
    expect(backBtn.textContent).toMatch(/⇺/);
    unskipPhaseMock.mockResolvedValueOnce(undefined);
    fireEvent.click(backBtn);
    await Promise.resolve();
    await Promise.resolve();
    // Back un-skips only — does NOT start a session.
    expect(unskipPhaseMock).toHaveBeenCalledWith("mt_test", "technical-design");
    expect(onStartSession).not.toHaveBeenCalled();
  });

  it("idea and done rows do not render a Skip button", () => {
    render(
      <TicketPhaseList
        ticket={makeTicket()}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    const ideaRow = screen.getByText("Idea").closest(".tpl-row")!;
    const doneRow = screen.getByText("Done").closest(".tpl-row")!;
    expect(ideaRow.querySelector("[title='Skip']")).toBeNull();
    expect(doneRow.querySelector("[title='Skip']")).toBeNull();
  });

  it("clicking the row label on a past phase with an artifact opens the artifact", () => {
    const onSelectPanel = vi.fn();
    render(
      <TicketPhaseList
        ticket={makeTicket({
          status: "technical-design",
          productDesignPath: ".bonsai/tickets/mt_test/product-design.md",
        })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={onSelectPanel}
      />,
    );
    const label = screen.getByText("Product design");
    fireEvent.click(label);
    expect(onSelectPanel).toHaveBeenCalledWith({ type: "artifact", kind: "product_design" });
  });

  it("Implementing row label opens its session via onSelectPanel", () => {
    const onSelectPanel = vi.fn();
    useSessionStore.setState({
      sessions: new Map([["sess1", { bonsaiSid: "sess1", name: "Implementation", status: "running" }]]),
    } as unknown as ReturnType<typeof useSessionStore.getState>);
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "implementing", orchestratorSessionId: "sess1" })}
        plan={null}
        phaseSessionIds={{ implementing: "sess1" }}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={onSelectPanel}
      />,
    );
    fireEvent.click(screen.getByText(/^Implementing$/));
    expect(onSelectPanel).toHaveBeenCalledWith({ type: "session", sessionId: "sess1" });
  });

  it("Done row shows Mark complete CTA when current status is implementing", () => {
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "implementing" })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    const cta = screen.getByTitle("Mark complete");
    fireEvent.click(cta);
    expect(updateTicketMock).toHaveBeenCalledWith("mt_test", { status: "done" });
  });

  it("status=idea with no sessions: idea row is current, PD row has ▶ Run", () => {
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "idea" })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    const ideaRow = screen.getByText("Idea").closest(".tpl-row")!;
    const pdRow = screen.getByText("Product design").closest(".tpl-row")!;
    expect(ideaRow.className).toContain("tpl-row--current");
    expect(pdRow.querySelector("[title='Run with AI']")).not.toBeNull();
  });

  it("status=product-design with PD session: PD row is current with ▶ Continue", () => {
    // Status === ongoing work: status="product-design" means PD is the active
    // phase. With a session attached for PD, the CTA is Continue.
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "product-design", sessionIds: ["pd_sid"] })}
        plan={null}
        phaseSessionIds={{ "product-design": "pd_sid" }}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    const ideaRow = screen.getByText("Idea").closest(".tpl-row")!;
    const pdRow = screen.getByText("Product design").closest(".tpl-row")!;
    expect(ideaRow.className).toContain("tpl-row--past");
    expect(pdRow.className).toContain("tpl-row--current");
    expect(pdRow.querySelector("[title='Continue']")).not.toBeNull();
  });

  it("status=technical-design with no TD session: TD row is current with ▶ Run", () => {
    // Status === ongoing work: status="technical-design" means TD is active.
    // No TD session yet → CTA is Run.
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "technical-design" })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    const pdRow = screen.getByText("Product design").closest(".tpl-row")!;
    const tdRow = screen.getByText("Technical design").closest(".tpl-row")!;
    expect(pdRow.className).toContain("tpl-row--past");
    expect(tdRow.className).toContain("tpl-row--current");
    expect(tdRow.querySelector("[title='Run with AI']")).not.toBeNull();
  });

  it("Run on current row with no existing session calls onStartSession with phase skill", () => {
    const onStartSession = vi.fn();
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "technical-design" })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={onStartSession}
        onSelectPanel={vi.fn()}
      />,
    );
    const tdRow = screen.getByText("Technical design").closest(".tpl-row")!;
    const runBtn = tdRow.querySelector("[title='Run with AI']") as HTMLButtonElement;
    fireEvent.click(runBtn);
    expect(onStartSession).toHaveBeenCalledWith("ticket-technical-design");
  });

  it("Continue on current row with existing session calls onStartSession", () => {
    const onStartSession = vi.fn();
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "technical-design", sessionIds: ["td_sid"] })}
        plan={null}
        phaseSessionIds={{ "technical-design": "td_sid" }}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={onStartSession}
        onSelectPanel={vi.fn()}
      />,
    );
    const tdRow = screen.getByText("Technical design").closest(".tpl-row")!;
    const continueBtn = tdRow.querySelector("[title='Continue']") as HTMLButtonElement;
    fireEvent.click(continueBtn);
    expect(onStartSession).toHaveBeenCalledWith("ticket-technical-design");
  });

  it("Refine on past row calls onStartSession (handler routes to existing session)", () => {
    const onStartSession = vi.fn();
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "technical-design", sessionIds: ["pd_sid"] })}
        plan={null}
        phaseSessionIds={{ "product-design": "pd_sid" }}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={onStartSession}
        onSelectPanel={vi.fn()}
      />,
    );
    const pdRow = screen.getByText("Product design").closest(".tpl-row")!;
    const refine = pdRow.querySelector(".tpl-icon-btn--refine, .tpl-icon-btn--back") as HTMLButtonElement;
    expect(refine).not.toBeNull();
    fireEvent.click(refine);
    expect(onStartSession).toHaveBeenCalledWith("ticket-product-design");
  });

  it("past row without a session does not render a Refine button", () => {
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "technical-design" })}
        plan={null}
        phaseSessionIds={{}}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={vi.fn()}
      />,
    );
    const pdRow = screen.getByText("Product design").closest(".tpl-row")!;
    expect(pdRow.querySelector(".tpl-icon-btn--refine, .tpl-icon-btn--back")).toBeNull();
  });

  it("clicking row label opens the phase's session when one exists", () => {
    const onSelectPanel = vi.fn();
    render(
      <TicketPhaseList
        ticket={makeTicket({ status: "technical-design", sessionIds: ["pd_sid"] })}
        plan={null}
        phaseSessionIds={{ "product-design": "pd_sid" }}
        phaseSessionArtifacts={{}}
        historyCountByPhase={{}}
        amendSpecsFiles={[]}
        sessionTodoState={new Map()}
        onScrollSessionToEvent={vi.fn()}
        onStartSession={vi.fn()}
        onSelectPanel={onSelectPanel}
      />,
    );
    const label = screen.getByText("Product design");
    fireEvent.click(label);
    expect(onSelectPanel).toHaveBeenCalledWith({ type: "session", sessionId: "pd_sid" });
  });
});
