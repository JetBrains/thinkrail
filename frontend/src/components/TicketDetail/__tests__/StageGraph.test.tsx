// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { StageGraph } from "../StageGraph.tsx";

afterEach(cleanup);
import type { TicketState } from "@/types/rpc-methods.ts";

const state = {
  id: "t", title: "T", body: "", type: "feature", rev: 1,
  lifecycle: "design", orchestrator: { kind: "session", sessionId: "o", builtinId: null },
  stages: [
    { id: "pd", title: "Product design", skill: "ticket-product-design",
      dependsOn: [], status: "done", runs: [], children: null,
      executesPlan: false, summary: null, artifactKind: "product_design",
      completedAt: "t1" },
    { id: "impl", title: "Implementing", skill: "ticket-implement",
      dependsOn: ["pd"], status: "running", runs: [], children: [],
      executesPlan: true, summary: null, artifactKind: null, completedAt: null },
  ],
  steps: [], sessions: [], linkedSpecIds: [], created: "", updated: "",
} as unknown as TicketState;

describe("StageGraph", () => {
  it("renders one row per stage with status", () => {
    render(<StageGraph state={state} onFocusNode={() => {}} />);
    expect(screen.getByText("Product design")).toBeTruthy();
    expect(screen.getByText("Implementing")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
  });

  it("done node shows Refine button and no force-complete button", () => {
    const onFocusNode = vi.fn();
    const onRefineNode = vi.fn();
    const onCompleteNode = vi.fn();
    render(
      <StageGraph
        state={state}
        onFocusNode={onFocusNode}
        onCompleteNode={onCompleteNode}
        onRefineNode={onRefineNode}
      />,
    );
    const pdRow = screen.getByText("Product design").closest(".stage-row")!;
    expect(pdRow.querySelector("[aria-label='refine stage']")).toBeTruthy();
    expect(pdRow.querySelector("[aria-label='force complete stage']")).toBeNull();
  });

  it("clicking Refine calls onRefineNode(id) and does not call onFocusNode", () => {
    const onFocusNode = vi.fn();
    const onRefineNode = vi.fn();
    render(
      <StageGraph
        state={state}
        onFocusNode={onFocusNode}
        onRefineNode={onRefineNode}
      />,
    );
    const btn = screen.getByLabelText("refine stage");
    fireEvent.click(btn);
    expect(onRefineNode).toHaveBeenCalledWith("pd");
    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it("running node shows bare force-complete button (aria-label) and no refine button", () => {
    const onFocusNode = vi.fn();
    const onCompleteNode = vi.fn();
    render(
      <StageGraph
        state={state}
        onFocusNode={onFocusNode}
        onCompleteNode={onCompleteNode}
      />,
    );
    const implRow = screen.getByText("Implementing").closest(".stage-row")!;
    expect(implRow.querySelector("[aria-label='force complete stage']")).toBeTruthy();
    expect(implRow.querySelector("[aria-label='refine stage']")).toBeNull();
  });

  it("clicking force-complete calls onCompleteNode(id) and does not call onFocusNode", () => {
    const onFocusNode = vi.fn();
    const onCompleteNode = vi.fn();
    render(
      <StageGraph
        state={state}
        onFocusNode={onFocusNode}
        onCompleteNode={onCompleteNode}
      />,
    );
    const btn = screen.getByLabelText("force complete stage");
    fireEvent.click(btn);
    expect(onCompleteNode).toHaveBeenCalledWith("impl");
    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it("node with artifactKind shows expand chevron; expanding reveals artifact sub-row", () => {
    const onSelectArtifact = vi.fn();
    render(
      <StageGraph
        state={state}
        onFocusNode={() => {}}
        onSelectArtifact={onSelectArtifact}
      />,
    );
    // Product design node has artifactKind — find its chevron by querying
    // all chevron spans and clicking the one in the Product design row.
    const pdRow = screen.getByText("Product design").closest(".stage-row")!;
    const chevron = pdRow.querySelector(".stage-chevron") as HTMLElement;
    expect(chevron).toBeTruthy();
    fireEvent.click(chevron);
    const artifactRow = screen.getByText("product design");
    expect(artifactRow).toBeTruthy();
    fireEvent.click(artifactRow);
    expect(onSelectArtifact).toHaveBeenCalledWith("product_design");
  });

  it("status label is the last element in the stage-actions group (right-aligned)", () => {
    render(<StageGraph state={state} onFocusNode={() => {}} />);
    const actionsGroups = document.querySelectorAll(".stage-actions");
    for (const group of actionsGroups) {
      const children = Array.from(group.children);
      const last = children[children.length - 1];
      expect(last?.classList.contains("stage-status")).toBe(true);
    }
  });

  it("running node is expanded by default (shows stage-sub-rows immediately)", () => {
    const stateWithRuns = {
      ...state,
      stages: [
        {
          id: "impl", title: "Implementing", skill: "ticket-implement",
          dependsOn: [], status: "running",
          runs: [{ kind: "session", sessionId: "sess-1", status: "running" }],
          children: [], executesPlan: true, summary: null, artifactKind: null, completedAt: null,
        },
      ],
    } as unknown as TicketState;
    render(<StageGraph state={stateWithRuns} onFocusNode={() => {}} />);
    expect(document.querySelector(".stage-sub-rows")).toBeTruthy();
  });

  it("done node is collapsed by default", () => {
    const stateOnlyDone = {
      ...state,
      stages: [
        { id: "pd", title: "Product design", skill: "ticket-product-design",
          dependsOn: [], status: "done", runs: [], children: null,
          executesPlan: false, summary: null, artifactKind: "product_design",
          completedAt: "t1" },
      ],
    } as unknown as TicketState;
    render(<StageGraph state={stateOnlyDone} onFocusNode={() => {}} />);
    expect(document.querySelector(".stage-sub-rows")).toBeNull();
  });

  it("running node renders the live-dot indicator", () => {
    render(<StageGraph state={state} onFocusNode={() => {}} />);
    const implRow = screen.getByText("Implementing").closest(".stage-row")!;
    expect(implRow.querySelector(".stage-live-dot")).toBeTruthy();
  });

  it("done node does not render the live-dot indicator", () => {
    render(<StageGraph state={state} onFocusNode={() => {}} />);
    const pdRow = screen.getByText("Product design").closest(".stage-row")!;
    expect(pdRow.querySelector(".stage-live-dot")).toBeNull();
  });
});
