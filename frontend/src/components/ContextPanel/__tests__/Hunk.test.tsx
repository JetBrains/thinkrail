// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

// Mock Monaco so it renders a plain textarea in jsdom.
vi.mock("@monaco-editor/react", () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="hunk-edit-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Mock useMonacoTheme since it relies on a global monaco instance.
vi.mock("@/components/MarkdownEditor/useMonacoTheme.ts", () => ({
  useMonacoTheme: () => "vs-dark",
}));

import { Hunk } from "@/components/ContextPanel/Hunk.tsx";

const baseProps = {
  requestId: "r1",
  index: 1,
  oldString: "original goal",
  newString: "refined goal",
  language: "markdown",
  rationale: "tighter wording",
  section: "Goals",
  validationWarnings: [],
  state: "pending" as const,
  resolution: null,
  onResolve: vi.fn(),
};

describe("Hunk — static states", () => {
  it("renders the four toolbar buttons when pending", () => {
    render(<Hunk {...baseProps} />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /discuss/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });

  it("calls onResolve with allow+original when Accept clicked", () => {
    const onResolve = vi.fn();
    render(<Hunk {...baseProps} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onResolve).toHaveBeenCalledWith({ behavior: "allow", applied: "original" });
  });

  it("calls onResolve with deny+no-discuss when Reject clicked", () => {
    const onResolve = vi.fn();
    render(<Hunk {...baseProps} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith({ behavior: "deny", discuss: false });
  });

  it("shows Accepted status pill when state=accepted", () => {
    render(
      <Hunk
        {...baseProps}
        state="accepted"
        resolution={{ behavior: "allow", applied: "original" }}
      />,
    );
    expect(screen.getByText(/^accepted$/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("shows Rejected status pill when state=rejected", () => {
    render(
      <Hunk
        {...baseProps}
        state="rejected"
        resolution={{ behavior: "deny", discuss: false }}
      />,
    );
    expect(screen.getByText(/^rejected$/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("renders validation warnings when present", () => {
    render(
      <Hunk
        {...baseProps}
        validationWarnings={[{ kind: "warning", message: "trailing space" }]}
      />,
    );
    expect(screen.getByText(/trailing space/i)).toBeTruthy();
  });

  it("renders rationale as ▸ prefix in the toolbar", () => {
    render(<Hunk {...baseProps} />);
    expect(screen.getByText(/tighter wording/i)).toBeTruthy();
  });
});

describe("Hunk — interactive states", () => {
  it("Edit → Apply emits allow+edited with the edited text", () => {
    const onResolve = vi.fn();
    render(<Hunk {...baseProps} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const editor = screen.getByTestId("hunk-edit-textarea");
    fireEvent.change(editor, { target: { value: "edited content" } });
    fireEvent.click(screen.getByRole("button", { name: /apply edit/i }));
    expect(onResolve).toHaveBeenCalledWith({
      behavior: "allow",
      applied: "edited",
      edited_new_string: "edited content",
    });
  });

  it("Edit → Cancel reverts to pending toolbar", () => {
    render(<Hunk {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByRole("button", { name: /^✓ accept$/i })).toBeTruthy();
  });

  it("Discuss → Send emits deny+discuss+feedback", () => {
    const onResolve = vi.fn();
    render(<Hunk {...baseProps} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /discuss/i }));
    const ta = screen.getByTestId("hunk-discuss-textarea");
    fireEvent.change(ta, { target: { value: "wrong direction" } });
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    expect(onResolve).toHaveBeenCalledWith({
      behavior: "deny",
      discuss: true,
      feedback: "wrong direction",
    });
  });
});
