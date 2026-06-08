// @vitest-environment jsdom
/**
 * Unit tests for `PromptPreview` placeholder-while-unsaved behaviour
 * (draft-session-design: "Draft-on-Type deltas" — DraftConfigCard prompt
 * preview shows a placeholder hint while `unsaved`).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { PromptSection } from "@/types/session.ts";

afterEach(cleanup);

vi.mock("@monaco-editor/react", () => ({ default: () => null }));
vi.mock("@/components/MarkdownEditor/useMonacoTheme.ts", () => ({
  useMonacoTheme: () => "vs-dark",
}));

import { PromptPreview } from "../PromptPreview.tsx";

describe("PromptPreview placeholder", () => {
  it("renders the placeholder hint while unsaved", () => {
    render(<PromptPreview systemPrompt="" sections={null} unsaved />);

    expect(screen.getByText(/preview appears once you start typing/i)).toBeTruthy();
    // The real toggle/token-count header is not rendered in placeholder mode.
    expect(screen.queryByText(/System Prompt/)).toBeNull();
  });

  it("renders the real preview when saved", () => {
    const sections: PromptSection[] = [
      { key: "general", label: "General", tokens: 100, content: "## General\n\nhi" },
    ];
    render(
      <PromptPreview
        systemPrompt="## General\n\nhi"
        sections={sections}
        unsaved={false}
      />,
    );

    // Header with token count is shown; placeholder hint is absent.
    expect(screen.getByText("System Prompt")).toBeTruthy();
    expect(screen.queryByText(/preview appears once you start typing/i)).toBeNull();

    // Expanding reveals the section legend.
    fireEvent.click(screen.getByText("System Prompt"));
    expect(screen.getByText(/General \(100\)/)).toBeTruthy();
  });
});
