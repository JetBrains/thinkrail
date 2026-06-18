// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OrchestrationControls } from "../OrchestrationControls.tsx";

afterEach(cleanup);

describe("OrchestrationControls", () => {
  it("clicking the active option does not call onChange", () => {
    const onChange = vi.fn();
    render(<OrchestrationControls
      config={{ stageGate: "approve", stepGate: "approve", failurePolicy: "fail-fast" }}
      onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("stages: approve"));
    expect(onChange).toHaveBeenCalledWith({ stageGate: "approve" });
  });

  it("clicking the inactive option calls onChange with that value — stageGate", () => {
    const onChange = vi.fn();
    render(<OrchestrationControls
      config={{ stageGate: "approve", stepGate: "approve", failurePolicy: "fail-fast" }}
      onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("stages: autonomous"));
    expect(onChange).toHaveBeenCalledWith({ stageGate: "autonomous" });
  });

  it("clicking the inactive option calls onChange — stepGate autonomous", () => {
    const onChange = vi.fn();
    render(<OrchestrationControls
      config={{ stageGate: "approve", stepGate: "approve", failurePolicy: "fail-fast" }}
      onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("steps: autonomous"));
    expect(onChange).toHaveBeenCalledWith({ stepGate: "autonomous" });
  });

  it("calls onChange for failure policy — wait-all", () => {
    const onChange = vi.fn();
    render(<OrchestrationControls
      config={{ stageGate: "approve", stepGate: "approve", failurePolicy: "fail-fast" }}
      onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("on failure: wait-all"));
    expect(onChange).toHaveBeenCalledWith({ failurePolicy: "wait-all" });
  });

  it("calls onChange for step execution — subagent", () => {
    const onChange = vi.fn();
    render(<OrchestrationControls config={{ stepExecution: "interactive" }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("steps run: subagent"));
    expect(onChange).toHaveBeenCalledWith({ stepExecution: "subagent" });
  });

  it("calls onChange for step execution — interactive", () => {
    const onChange = vi.fn();
    render(<OrchestrationControls config={{ stepExecution: "subagent" }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("steps run: interactive"));
    expect(onChange).toHaveBeenCalledWith({ stepExecution: "interactive" });
  });

  it("active pill has orch-pill--active class", () => {
    render(<OrchestrationControls
      config={{ stageGate: "autonomous" }}
      onChange={vi.fn()} />);
    expect(screen.getByLabelText("stages: autonomous").classList.contains("orch-pill--active")).toBe(true);
    expect(screen.getByLabelText("stages: approve").classList.contains("orch-pill--active")).toBe(false);
  });

});
