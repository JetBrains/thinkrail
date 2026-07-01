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
    fallbackSummary: "",
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

  it("disables 'Return with result' while drafting with no text or fallback", () => {
    render(
      <ReturnToParentDialog
        {...makeProps({ drafting: true, draftSummary: "", fallbackSummary: "" })}
      />,
    );
    const btn = screen.getByRole("button", { name: /Return with result/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows the last-message fallback (editable) while drafting, so it never blocks", () => {
    render(
      <ReturnToParentDialog
        {...makeProps({ drafting: true, draftSummary: "", fallbackSummary: "previous message" })}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("previous message");
    const btn = screen.getByRole("button", { name: /Return with result/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
