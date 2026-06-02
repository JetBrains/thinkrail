// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

import { ProposeChangeChip, type HunkSummary } from "@/components/ChatStream/ProposeChangeChip.tsx";

function pending(n: number): HunkSummary[] {
  return Array.from({ length: n }, (_, i) => ({
    requestId: `r${i}`,
    state: "pending" as const,
    section: i === 0 ? "Goals" : null,
    added: 3,
    removed: 1,
  }));
}

function makeProps(overrides: Partial<React.ComponentProps<typeof ProposeChangeChip>> = {}) {
  return {
    filePath: "design.md",
    hunks: pending(3),
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
    onDiscuss: vi.fn(),
    onReview: vi.fn(),
    ...overrides,
  };
}

describe("ProposeChangeChip", () => {
  it("renders path and total count for multi-hunk", () => {
    render(<ProposeChangeChip {...makeProps()} />);
    expect(screen.getByText(/design\.md/)).toBeTruthy();
    expect(screen.getByText(/3 changes/)).toBeTruthy();
  });

  it("shows section when only one hunk has one", () => {
    const single: HunkSummary[] = [
      { requestId: "r0", state: "pending", section: "Goals", added: 3, removed: 1 },
    ];
    render(<ProposeChangeChip {...makeProps({ hunks: single })} />);
    expect(screen.getByText(/§ Goals/)).toBeTruthy();
  });

  it("hides Accept all / Discuss / Reject all when no pending", () => {
    const resolved: HunkSummary[] = [
      { requestId: "r0", state: "accepted", section: null, added: 1, removed: 0 },
    ];
    render(<ProposeChangeChip {...makeProps({ hunks: resolved })} />);
    expect(screen.queryByRole("button", { name: /accept all/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject all/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^discuss$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /review/i })).toBeTruthy();
  });

  it("clicking Review calls onReview", () => {
    const onReview = vi.fn();
    render(<ProposeChangeChip {...makeProps({ onReview })} />);
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("clicking Accept all calls onAcceptAll", () => {
    const onAcceptAll = vi.fn();
    render(<ProposeChangeChip {...makeProps({ onAcceptAll })} />);
    fireEvent.click(screen.getByRole("button", { name: /accept all/i }));
    expect(onAcceptAll).toHaveBeenCalledOnce();
  });

  it("clicking Reject all calls onRejectAll", () => {
    const onRejectAll = vi.fn();
    render(<ProposeChangeChip {...makeProps({ onRejectAll })} />);
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    expect(onRejectAll).toHaveBeenCalledOnce();
  });

  it("Discuss opens textarea, Send calls onDiscuss", () => {
    const onDiscuss = vi.fn();
    render(<ProposeChangeChip {...makeProps({ onDiscuss })} />);
    fireEvent.click(screen.getByRole("button", { name: /^discuss$/i }));
    const ta = screen.getByTestId("chip-discuss-textarea");
    fireEvent.change(ta, { target: { value: "feedback for all" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onDiscuss).toHaveBeenCalledWith("feedback for all");
  });

  it("shows progress bar segments when there are resolved hunks", () => {
    const mixed: HunkSummary[] = [
      { requestId: "r0", state: "accepted", section: null, added: 1, removed: 0 },
      { requestId: "r1", state: "rejected", section: null, added: 1, removed: 0 },
      { requestId: "r2", state: "pending", section: null, added: 1, removed: 0 },
    ];
    render(<ProposeChangeChip {...makeProps({ hunks: mixed })} />);
    expect(screen.getByText(/1 accepted/i)).toBeTruthy();
    expect(screen.getByText(/1 rejected/i)).toBeTruthy();
    expect(screen.getByText(/1 pending/i)).toBeTruthy();
  });
});
