// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

vi.mock("@monaco-editor/react", () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="hunk-edit-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("@/components/MarkdownEditor/useMonacoTheme.ts", () => ({
  useMonacoTheme: () => "vs-dark",
}));

import { ReviewPanel, type ReviewHunk } from "@/components/ContextPanel/ReviewPanel.tsx";

const fixtureContent = `# Title

Some intro paragraph.

## Goals

Original goal text here.

## Non-goals

Out of scope.`;

const fixtureHunks: ReviewHunk[] = [
  {
    requestId: "r1",
    filePath: "design.md",
    oldString: "Original goal text here.",
    newString: "Refined goal text with retries.",
    section: "Goals",
    rationale: "tighter",
    validationWarnings: [],
    state: "pending",
    resolution: null,
  },
];

function makeProps(overrides: Partial<React.ComponentProps<typeof ReviewPanel>> = {}) {
  return {
    filePath: "design.md",
    content: fixtureContent,
    hunks: fixtureHunks,
    onResolve: vi.fn(),
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
    onDiscuss: vi.fn(),
    ...overrides,
  };
}

describe("ReviewPanel", () => {
  it("renders the file path header", () => {
    render(<ReviewPanel {...makeProps()} />);
    expect(screen.getAllByText(/design\.md/i).length).toBeGreaterThan(0);
  });

  it("renders one Hunk per request (Accept button visible)", () => {
    render(<ReviewPanel {...makeProps()} />);
    // Hunk's Accept button + ReviewPanel's "Accept all"
    expect(screen.getAllByRole("button", { name: /accept/i }).length).toBeGreaterThan(1);
  });

  it("shows pending count in toolbar", () => {
    render(<ReviewPanel {...makeProps()} />);
    expect(screen.getByText(/1 pending/i)).toBeTruthy();
  });

  it("hides bottom action bar when no pending hunks", () => {
    const resolved: ReviewHunk[] = [{ ...fixtureHunks[0], state: "accepted" }];
    render(<ReviewPanel {...makeProps({ hunks: resolved })} />);
    expect(screen.queryByRole("button", { name: /accept all/i })).toBeNull();
  });

  it("clicking Accept all calls onAcceptAll", () => {
    const onAcceptAll = vi.fn();
    render(<ReviewPanel {...makeProps({ onAcceptAll })} />);
    fireEvent.click(screen.getByRole("button", { name: /accept all/i }));
    expect(onAcceptAll).toHaveBeenCalledOnce();
  });

  it("clicking Discuss opens textarea; Send calls onDiscuss", () => {
    const onDiscuss = vi.fn();
    render(<ReviewPanel {...makeProps({ onDiscuss })} />);
    fireEvent.click(screen.getByRole("button", { name: /^discuss$/i }));
    const ta = screen.getByTestId("rp-discuss-textarea");
    fireEvent.change(ta, { target: { value: "needs more context" } });
    fireEvent.click(screen.getByRole("button", { name: /send to all pending/i }));
    expect(onDiscuss).toHaveBeenCalledWith("needs more context");
  });

  it("Focused/Full file toggle is present for markdown", () => {
    render(<ReviewPanel {...makeProps()} />);
    expect(screen.getByRole("button", { name: /focused/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /full file/i })).toBeTruthy();
  });

  it("Rendered/Source toggle present for .md, absent for .py", () => {
    const { rerender } = render(<ReviewPanel {...makeProps()} />);
    expect(screen.getByRole("button", { name: /^rendered$/i })).toBeTruthy();

    rerender(<ReviewPanel {...makeProps({ filePath: "code.py" })} />);
    expect(screen.queryByRole("button", { name: /^rendered$/i })).toBeNull();
  });
});
