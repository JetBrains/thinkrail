// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import StepProposalCard from "../StepProposalCard";
import { classicRenderers } from "../renderers/classicRenderer";
import { useSessionStore } from "@/store/sessionStore";
import type { AgentEvent } from "@/types/agent";
import type { EventRenderContext } from "../renderers/types";
import type { Session } from "@/types/session";

// ── Unit: StepProposalCard renders fields + fires callbacks ────────────

describe("StepProposalCard", () => {
  const baseProps = {
    ticketId: "mt_x",
    stepNumber: 1,
    stepTitle: "Create foo.py",
    skill: "default",
    inputSpecIds: ["spec-a", "spec-b"],
    reason: "Foundation step",
    answered: false,
    onApprove: vi.fn(),
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    baseProps.onApprove.mockClear();
    baseProps.onDismiss.mockClear();
  });

  it("renders ticket id, step number, title, reason, skill", () => {
    render(<StepProposalCard {...baseProps} />);
    expect(screen.getByText(/mt_x/)).toBeTruthy();
    expect(screen.getByText(/Step 1: Create foo.py/)).toBeTruthy();
    expect(screen.getByText(/Foundation step/)).toBeTruthy();
    expect(screen.getByText("default")).toBeTruthy();
    expect(screen.getByText(/spec-a, spec-b/)).toBeTruthy();
  });

  it("calls onApprove when Start Step is clicked", () => {
    render(<StepProposalCard {...baseProps} />);
    fireEvent.click(screen.getByText("Start Step"));
    expect(baseProps.onApprove).toHaveBeenCalledTimes(1);
  });

  it("opens the dismiss form then submits with the entered reason", () => {
    render(<StepProposalCard {...baseProps} />);
    fireEvent.click(screen.getByText("Dismiss…"));
    const textarea = screen.getByPlaceholderText(/tell the orchestrator/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "wrong order" } });
    fireEvent.click(screen.getByText("Dismiss"));
    expect(baseProps.onDismiss).toHaveBeenCalledWith("wrong order");
  });

  it("renders the answered state with the approved badge", () => {
    render(<StepProposalCard {...baseProps} answered decision="approved" />);
    expect(screen.getByText(/Step started/)).toBeTruthy();
    expect(screen.queryByText("Start Step")).toBeNull();
  });

  it("renders the answered state with the dismissed badge", () => {
    render(
      <StepProposalCard
        {...baseProps}
        answered
        decision="dismissed"
        dismissReason="not now"
      />,
    );
    expect(screen.getByText(/Dismissed/)).toBeTruthy();
  });
});

// ── Integration: classicRenderer.suggestStep → startSession contract ───
//
// This is the regression guard for the "newly created session is broken"
// bug: when the orchestrator's payload carries agentInstructions, the
// approve handler must forward it to startSession as `prompt`, otherwise
// the new step session opens with no instructions.

describe("classicRenderers.suggestStep approve flow", () => {
  function buildCtx(overrides: Partial<EventRenderContext> = {}): EventRenderContext {
    const currentSession: Partial<Session> = {
      bonsaiSid: "parent_sid",
      model: "claude-opus-4-7",
      permissionMode: "bypassPermissions",
      effort: "max",
    };
    return {
      toolStates: new Map(),
      activeSubagents: new Set(),
      subagentChildren: new Map(),
      latestVisByVisId: new Map(),
      approvalByToolIndex: new Map(),
      taskCollectionAnchor: null,
      taskCollection: [],
      answeredRequests: new Map(),
      onResolveRequest: vi.fn(),
      session: currentSession as Session,
      events: [],
      ...overrides,
    };
  }

  const fullPayload = {
    bonsaiSid: "parent_sid",
    ticketId: "mt_test",
    stepNumber: 1,
    stepTitle: "Create backend/app/core/last_used.py",
    skill: "default",
    inputSpecIds: ["module-core", "module-app-store"],
    agentInstructions: "Read the design doc, then create the file with...",
    reason: "deps met",
    requestId: "req-1",
  };

  const event = {
    bonsaiSid: "parent_sid",
    sessionId: "",
    eventType: "suggestStep",
    payload: fullPayload,
  } as unknown as AgentEvent;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the step session and triggers the first turn with agentInstructions", async () => {
    const startSession = vi.fn().mockResolvedValue("new_sid");
    const switchSession = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useSessionStore, "getState").mockReturnValue({
      ...useSessionStore.getState(),
      startSession,
      switchSession,
      sendMessage,
    } as ReturnType<typeof useSessionStore.getState>);

    const ctx = buildCtx();
    const node = classicRenderers.suggestStep!(event as never, 0, "k", ctx);
    const { container } = render(<>{node}</>);

    fireEvent.click(container.querySelector(".chat-btn-approve") as HTMLButtonElement);
    // Yield twice — once for startSession, once for sendMessage
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(ctx.onResolveRequest).toHaveBeenCalledWith("req-1", { behavior: "allow" });
    expect(startSession).toHaveBeenCalledTimes(1);

    const arg = startSession.mock.calls[0][0];
    // The instructions go in as the first user message, not as the
    // startSession prompt arg (which would only enrich system context
    // and leave the session idle).
    expect(arg.prompt).toBeUndefined();
    // "default" is the plan-model sentinel for "no skill" — the approve
    // handler translates it to undefined so the backend doesn't try to
    // load a nonexistent skills/default/SKILL.md.
    expect(arg.skillId).toBeUndefined();
    expect(arg.specIds).toEqual(["module-core", "module-app-store"]);
    expect(arg.metaTicketId).toBe("mt_test");
    expect(arg.name).toBe("Step 1: Create backend/app/core/last_used.py");
    expect(arg.config.model).toBe("claude-opus-4-7");
    expect(arg.config.permissionMode).toBe("bypassPermissions");
    expect(arg.config.effort).toBe("max");
    expect(switchSession).toHaveBeenCalledWith("new_sid");
    // The new session must be kicked off with the step's instructions
    // — otherwise it sits idle forever.
    expect(sendMessage).toHaveBeenCalledWith("new_sid", fullPayload.agentInstructions);
  });

  it("dismiss sends a deny response with the reason", () => {
    const ctx = buildCtx();
    const node = classicRenderers.suggestStep!(event as never, 0, "k", ctx);
    const { container } = render(<>{node}</>);

    fireEvent.click(container.querySelector(".chat-btn-deny") as HTMLButtonElement);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "skip for now" } });
    fireEvent.click(screen.getByText("Dismiss"));

    expect(ctx.onResolveRequest).toHaveBeenCalledWith("req-1", {
      behavior: "deny",
      message: "Dismissed: skip for now",
      dismissReason: "skip for now",
    });
  });
});
