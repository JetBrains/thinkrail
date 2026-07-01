// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReturnToParentDialog } from "../ReturnToParentDialog.tsx";

afterEach(() => cleanup());

function makeProps(overrides = {}) {
  return {
    open: true,
    parentName: "Add OAuth login",
    targetKind: "question" as const,
    draftSummary: "use keychain",
    drafting: false,
    onRegenerate: vi.fn(),
    onReturnWith: vi.fn(),
    onReturnWithout: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("ReturnToParentDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ReturnToParentDialog {...makeProps({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the question target label", () => {
    render(<ReturnToParentDialog {...makeProps()} />);
    expect(screen.getByText(/Other.*field of the question/i)).toBeTruthy();
  });

  it("shows the message target label", () => {
    render(<ReturnToParentDialog {...makeProps({ targetKind: "message" })} />);
    expect(screen.getByText(/message box/i)).toBeTruthy();
  });

  it("returns the edited summary text on 'Return with result'", () => {
    const props = makeProps();
    render(<ReturnToParentDialog {...props} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: /Return with result/i }));
    expect(props.onReturnWith).toHaveBeenCalledWith("edited");
  });

  it("returns without a result", () => {
    const props = makeProps();
    render(<ReturnToParentDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Return without a result/i }));
    expect(props.onReturnWithout).toHaveBeenCalled();
  });

  it("disables 'Return with result' while drafting", () => {
    render(<ReturnToParentDialog {...makeProps({ drafting: true, draftSummary: "" })} />);
    const btn = screen.getByRole("button", { name: /Return with result/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
