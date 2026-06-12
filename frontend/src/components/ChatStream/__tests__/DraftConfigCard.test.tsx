// @vitest-environment jsdom
/**
 * Component tests for `DraftConfigCard` draft-on-type wiring and the
 * `PromptPreview` placeholder-while-unsaved behaviour (draft-session-design:
 * "DraftConfigCard Component", "Draft-on-Type deltas").
 *
 * Heavy popover children (SkillGrid / SpecSelector / TicketSelector /
 * FileSelector) and `PromptPreview` (Monaco + react-markdown) are stubbed so
 * the test focuses on the card's own wiring: the name input → `renameDraft`
 * (which freezes live name derivation) and the `unsaved` flag flowing into
 * `PromptPreview`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { useSessionStore } from "@/store/sessionStore.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import type { Session } from "@/types/session.ts";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/components/shared/SkillGrid.tsx", () => ({ SkillGrid: () => null }));
vi.mock("@/components/shared/SpecSelector.tsx", () => ({ SpecSelector: () => null }));
vi.mock("@/components/shared/TicketSelector.tsx", () => ({ TicketSelector: () => null }));
vi.mock("@/components/shared/FileSelector.tsx", () => ({ FileSelector: () => null }));
vi.mock("@/components/shared/RuntimeFlags.tsx", () => ({ RuntimeFlags: () => null }));
vi.mock("@/components/shared/StaleRefsBanner.tsx", () => ({ StaleRefsBanner: () => null }));
vi.mock("@/services/files.ts", () => ({ browseFiles: vi.fn(async () => ({ paths: [] })) }));

// Capture the props PromptPreview receives so we can assert on `unsaved`.
const promptPreviewProps: Array<Record<string, unknown>> = [];
vi.mock("../PromptPreview.tsx", () => ({
  PromptPreview: (props: Record<string, unknown>) => {
    promptPreviewProps.push(props);
    return <div data-testid="prompt-preview" data-unsaved={String(props.unsaved)} />;
  },
}));

import { DraftConfigCard } from "../DraftConfigCard.tsx";

// ── Fixtures ──────────────────────────────────────────────────────────────

const SID = "draft-session-1";

function makeDraft(overrides: Partial<Session> = {}): Session {
  return {
    thinkrailSid: SID,
    name: "New session",
    skillId: null,
    specIds: [],
    filePaths: [],
    status: "draft",
    unsaved: true,
    model: "claude-sonnet-4-6",
    permissionMode: "default",
    effort: "auto",
    flags: {},
    startedAt: Date.now(),
    events: [],
    metrics: { costUsd: 0, turns: 0, durationMs: 0, contextUsage: undefined },
    pendingRequests: [],
    answeredRequests: new Map(),
    ticketId: null,
    parentThinkrailSid: null,
    subsessionType: null,
    subsessionContext: null,
    returnStatus: null,
    returnSummary: null,
    ...overrides,
  } as unknown as Session;
}

function seed(session: Session) {
  useSpecStore.setState({ specs: [] });
  useBoardStore.setState({ tickets: new Map() });
  useSettingsStore.setState({ skills: [] });
  useRuntimeCapsStore.setState({
    capsByRuntime: {
      claude: { models: [], permissionModes: [], effortLevels: [], flags: [] },
    },
  });
  useSessionStore.setState({ sessions: new Map<string, Session>([[SID, session]]) });
}

beforeEach(() => {
  promptPreviewProps.length = 0;
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("DraftConfigCard name input", () => {
  it("calls renameDraft and freezes live name derivation", () => {
    seed(makeDraft());
    const realRename = useSessionStore.getState().renameDraft;
    const renameSpy = vi.fn(async () => {});
    useSessionStore.setState({ renameDraft: renameSpy });

    try {
      render(<DraftConfigCard thinkrailSid={SID} />);

      const input = screen.getByPlaceholderText("Session name...") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "fix login" } });

      expect(renameSpy).toHaveBeenCalledWith(SID, "fix login");
    } finally {
      useSessionStore.setState({ renameDraft: realRename });
    }
  });

  it("renameDraft sets nameManuallySet so subsequent typing no longer changes the name", async () => {
    seed(makeDraft());
    // Use the real store action to prove derivation freezes.
    await useSessionStore.getState().renameDraft(SID, "my custom name");

    const after = useSessionStore.getState().sessions.get(SID);
    expect(after?.name).toBe("my custom name");
    expect(after?.nameManuallySet).toBe(true);

    // Live derivation is now frozen — noteDraftInput leaves the name alone.
    useSessionStore.getState().noteDraftInput(SID, "completely different prompt text");
    expect(useSessionStore.getState().sessions.get(SID)?.name).toBe("my custom name");
  });
});

describe("DraftConfigCard prompt preview placeholder", () => {
  it("passes unsaved=true to PromptPreview while the draft is unsaved", () => {
    seed(makeDraft({ unsaved: true }));
    render(<DraftConfigCard thinkrailSid={SID} />);

    const preview = screen.getByTestId("prompt-preview");
    expect(preview.getAttribute("data-unsaved")).toBe("true");
  });

  it("passes unsaved=false once the draft has been saved", () => {
    seed(makeDraft({ unsaved: false, systemPrompt: "## General\n..." }));
    render(<DraftConfigCard thinkrailSid={SID} />);

    const preview = screen.getByTestId("prompt-preview");
    expect(preview.getAttribute("data-unsaved")).toBe("false");
  });
});
