// @vitest-environment jsdom
/**
 * Integration tests for `InputArea` autocomplete refactor.
 *
 * Covers design-doc §3 (UX) and §6.6 (refactor):
 *   - Popup opens for `/` mid-input (after whitespace), not just at the start.
 *   - Popup renders two labelled sections: "Bonsai" first, then the active
 *     runtime's `displayName` ("Claude Code") — labels asserted by text, not
 *     by value (per the e2e-section-label memory note).
 *   - Tab inserts ``/skill-id `` at the caret, preserving the text before
 *     and after the token.
 *   - Clicking a runtime suggestion inserts the right id.
 *   - `loadRuntimeSkills` is invoked for the effective runtime on mount.
 *   - When the runtime cache is empty, the popup gracefully shows the
 *     Bonsai section only.
 *
 * The underlying hook (`useSlashAutocomplete`) is independently covered by
 * `hooks/__tests__/useSlashAutocomplete.test.ts`; these tests focus on
 * the *wiring* between the hook, the textarea, and the popup DOM.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import { useSettingsStore } from "@/store/settingsStore.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useInputDraftStore } from "@/store/inputDraftStore.ts";
import type { Skill } from "@/constants/skills.ts";
import type { RuntimeSkillInfo, RuntimeType } from "@/types/agent.ts";
import type { RuntimeIdentity } from "@/types/rpc-methods.ts";
import type { Session } from "@/types/session.ts";

// ── Mocks ─────────────────────────────────────────────────────────────────

// Voice input pulls in the RPC client at import time — stub it out so the
// component renders cleanly in jsdom without network/audio dependencies.
vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    isSupported: false,
    mode: "unsupported" as const,
    isRecording: false,
    isTranscribing: false,
    isRevising: false,
    interimText: "",
    error: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(async () => ""),
    cancelRecording: vi.fn(),
    reviseTranscript: vi.fn(async (s: string) => s),
  }),
}));

// MessageHistory + ChatMarkdown pull in heavier dependencies (markdown
// renderer, message-history store).  Stub them to keep the test focused
// on autocomplete wiring.
vi.mock("../MessageHistory", () => ({
  MessageHistory: () => null,
}));
vi.mock("../ChatMarkdown", () => ({
  ChatMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { InputArea } from "../InputArea.tsx";

// ── Fixtures ──────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-1";

const BONSAI_SKILLS: Skill[] = [
  { id: "spec-status", icon: "S", name: "Status", description: "Show spec status", group: "Review" },
  { id: "spec-next", icon: "N", name: "Next", description: "Suggest next spec", group: "Review" },
];

const RUNTIME_SKILLS: RuntimeSkillInfo[] = [
  { id: "review", name: "Review", description: "Review a pull request", source: "builtin" },
  { id: "init", name: "Init", description: "Init CLAUDE.md", source: "builtin" },
];

const CLAUDE_IDENTITY: RuntimeIdentity = {
  runtimeType: "claude",
  displayName: "Claude Code",
};

function seedStores({
  draft = "",
  bonsai = BONSAI_SKILLS,
  runtimeSkills = RUNTIME_SKILLS,
  runtimeMeta = [CLAUDE_IDENTITY] as RuntimeIdentity[],
  runtime = "claude" as RuntimeType,
}: {
  draft?: string;
  bonsai?: Skill[];
  runtimeSkills?: RuntimeSkillInfo[];
  runtimeMeta?: RuntimeIdentity[];
  runtime?: RuntimeType;
} = {}) {
  useSettingsStore.setState({
    skills: bonsai,
    runtimeSkills: new Map<RuntimeType, RuntimeSkillInfo[]>([[runtime, runtimeSkills]]),
  });
  useRuntimeCapsStore.setState({ runtimes: runtimeMeta });
  // Seed a minimal session so `useSessionStore.sessions.get(sessionId)`
  // returns *something* — the model field is read for runtime derivation.
  const stub = {
    bonsaiSid: SESSION_ID,
    name: "Test",
    skillId: null,
    specIds: [],
    filePaths: [],
    status: "idle",
    model: "",
    permissionMode: "default",
    effort: null,
    startedAt: Date.now(),
    events: [],
    metrics: { costUsd: 0, turns: 0, durationMs: 0, contextUsage: undefined },
    pendingRequests: [],
    answeredRequests: new Map(),
    ticketId: null,
    parentBonsaiSid: null,
    subsessionType: null,
    subsessionContext: null,
    returnStatus: null,
    returnSummary: null,
  } as unknown as Session;
  useSessionStore.setState({
    sessions: new Map<string, Session>([[SESSION_ID, stub]]),
  });
  useInputDraftStore.setState({ drafts: new Map([[SESSION_ID, draft]]) });
}

function renderInputArea(overrides: Partial<React.ComponentProps<typeof InputArea>> = {}) {
  const onSend = vi.fn();
  const props = {
    sessionId: SESSION_ID,
    disabled: false,
    placeholder: "Type a message",
    onSend,
    ...overrides,
  };
  return { onSend, ...render(<InputArea {...props} />) };
}

/**
 * Drive the textarea like a user would: set the controlled value via
 * `onChange`, then place the caret via `setSelectionRange` and fire
 * `onSelect` so the InputArea picks up the new caret position.  React
 * Testing Library's `fireEvent.change` only triggers `onChange`, which
 * is enough for the value, but the hook also needs an explicit caret
 * update.
 */
function typeIntoTextarea(textarea: HTMLTextAreaElement, value: string, caret = value.length) {
  fireEvent.change(textarea, { target: { value } });
  textarea.setSelectionRange(caret, caret);
  fireEvent.select(textarea);
}

beforeEach(() => {
  // Spy on the store action so we can assert the mount-time refresh.
  // Reset via `setState` rather than the action itself to avoid the real
  // network call.
  useSettingsStore.setState({
    skills: [],
    runtimeSkills: new Map(),
    loadRuntimeSkills: vi.fn(async () => undefined) as never,
  });
  useRuntimeCapsStore.setState({ runtimes: null, capsByRuntime: {} });
  useSessionStore.setState({ sessions: new Map() });
  useInputDraftStore.setState({ drafts: new Map() });
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("InputArea autocomplete (grouped popup)", () => {
  it("invokes loadRuntimeSkills with the effective runtime on mount", () => {
    seedStores();
    const loadSpy = vi.fn(async () => undefined);
    useSettingsStore.setState({ loadRuntimeSkills: loadSpy as never });

    renderInputArea();

    expect(loadSpy).toHaveBeenCalledWith("claude");
  });

  it("renders two grouped sections (Bonsai first, then runtime displayName) when both have items", () => {
    seedStores();
    renderInputArea();

    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    typeIntoTextarea(textarea, "/");

    // Section headers — asserted by visible text, not value.
    const bonsaiHeader = screen.getByText("Bonsai");
    const runtimeHeader = screen.getByText("Claude Code");
    expect(bonsaiHeader).toBeTruthy();
    expect(runtimeHeader).toBeTruthy();

    // Bonsai items rendered.
    expect(screen.getByText("/spec-status")).toBeTruthy();
    expect(screen.getByText("/spec-next")).toBeTruthy();
    // Runtime items rendered.
    expect(screen.getByText("/review")).toBeTruthy();
    expect(screen.getByText("/init")).toBeTruthy();

    // Bonsai header comes first in DOM order.
    expect(
      bonsaiHeader.compareDocumentPosition(runtimeHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens the popup for `/` mid-input (after whitespace), not just at start", () => {
    seedStores();
    renderInputArea();
    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;

    typeIntoTextarea(textarea, "hello /spec");

    expect(screen.getByText("Bonsai")).toBeTruthy();
    expect(screen.getByText("/spec-status")).toBeTruthy();
  });

  it("does NOT open the popup for `/` inside a URL (preceded by non-whitespace)", () => {
    seedStores();
    renderInputArea();
    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;

    typeIntoTextarea(textarea, "see https://example.com/path");

    expect(screen.queryByText("Bonsai")).toBeNull();
    expect(screen.queryByText("Claude Code")).toBeNull();
  });

  it("Tab inserts `/spec-status ` at the caret, preserving prefix and suffix", () => {
    seedStores();
    renderInputArea();
    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;

    // Set "hello /spec world" with caret after `/spec`.
    typeIntoTextarea(textarea, "hello /spec world", "hello /spec".length);

    // Sanity: popup is open and the first suggestion is the only matching bonsai id.
    expect(screen.getByText("/spec-status")).toBeTruthy();

    fireEvent.keyDown(textarea, { key: "Tab" });

    // queueMicrotask runs before the next macrotask — flush by awaiting a no-op.
    return Promise.resolve().then(() => {
      const draft = useInputDraftStore.getState().drafts.get(SESSION_ID);
      expect(draft).toBe("hello /spec-status  world");
      //   "hello /spec"          (prefix, 11 chars)
      // + "/spec-status "        (replacement at token range [6, 11))
      // + " world"               (suffix, untouched)
      // Two spaces between "status" and "world": the inserted trailing
      // space + the user's original space before "world".
    });
  });

  it("clicking a runtime suggestion inserts its id", () => {
    seedStores();
    renderInputArea();
    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;

    typeIntoTextarea(textarea, "/");

    const reviewItem = screen.getByText("/review");
    fireEvent.mouseDown(reviewItem);

    return Promise.resolve().then(() => {
      const draft = useInputDraftStore.getState().drafts.get(SESSION_ID);
      expect(draft).toBe("/review ");
    });
  });

  it("ArrowDown navigation crosses the section boundary", () => {
    seedStores();
    renderInputArea();
    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;

    typeIntoTextarea(textarea, "/");

    // The first bonsai item should start out highlighted.
    const firstActive = document.querySelector(".input-autocomplete-active");
    expect(firstActive?.textContent).toContain("/spec-status");

    // 2 bonsai + 2 runtime; ArrowDown × 2 → enters runtime section.
    act(() => {
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
    });

    const afterTwo = document.querySelector(".input-autocomplete-active");
    expect(afterTwo?.textContent).toContain("/review");
  });

  it("omits the runtime section entirely when its cache is empty (Bonsai-only fallback)", () => {
    seedStores({ runtimeSkills: [] });
    renderInputArea();
    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;

    typeIntoTextarea(textarea, "/");

    expect(screen.getByText("Bonsai")).toBeTruthy();
    expect(screen.queryByText("Claude Code")).toBeNull();
    // Bonsai items still rendered.
    expect(screen.getByText("/spec-status")).toBeTruthy();
  });

  it("Escape closes the popup", () => {
    seedStores();
    renderInputArea();
    const textarea = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;

    typeIntoTextarea(textarea, "/");
    expect(screen.getByText("Bonsai")).toBeTruthy();

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(screen.queryByText("Bonsai")).toBeNull();
    expect(screen.queryByText("Claude Code")).toBeNull();
  });
});
