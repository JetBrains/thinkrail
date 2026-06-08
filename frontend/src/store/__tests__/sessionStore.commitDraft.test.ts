import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "@/types/session.ts";

const prepare = vi.fn(async () => ({ systemPrompt: "PROMPT", sections: [] }));
const updateDraft = vi.fn(async () => ({ systemPrompt: "PROMPT", sections: [] }));

vi.mock("@/api/index.ts", () => ({
  getClient: () => ({}),
}));
vi.mock("@/api/methods/agents.ts", () => ({
  createAgentApi: () => ({ prepare, updateDraft }),
}));
// Importing the real sessionStore runs `setCommitFn` at module load, which
// would overwrite the shared autosave `commit` singleton other suites set.
// Stub the controller — commitDraft is invoked directly here, not via timers.
vi.mock("@/store/draftAutosave.ts", () => ({
  setCommitFn: vi.fn(),
  noteInput: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(),
}));

import { useSessionStore } from "../sessionStore.ts";
import { useInputDraftStore } from "../inputDraftStore.ts";

const SID = "draft-1";

function seedDraft(overrides: Partial<Session> = {}): void {
  const session = {
    bonsaiSid: SID,
    name: "New session",
    skillId: null,
    specIds: [],
    filePaths: [],
    status: "draft",
    model: "claude-x",
    permissionMode: "default",
    effort: "auto",
    flags: {},
    startedAt: Date.now(),
    events: [],
    metrics: undefined,
    pendingRequests: [],
    answeredRequests: new Map(),
    ticketId: null,
    parentBonsaiSid: null,
    subsessionType: null,
    subsessionContext: null,
    returnStatus: null,
    returnSummary: null,
    ...overrides,
  } as unknown as Session;
  useSessionStore.setState({ sessions: new Map([[SID, session]]) });
}

beforeEach(() => {
  prepare.mockClear();
  updateDraft.mockClear();
  useSessionStore.setState({ sessions: new Map() });
  useInputDraftStore.setState({ drafts: new Map() });
});

describe("commitDraft sub-threshold guard", () => {
  it("is a no-op on an unsaved sub-threshold draft (no agent/prepare)", async () => {
    seedDraft({ unsaved: true });
    useInputDraftStore.setState({ drafts: new Map([[SID, "hi"]]) }); // 2 non-ws < 5

    await useSessionStore.getState().commitDraft(SID);

    expect(prepare).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions.get(SID)?.unsaved).toBe(true);
  });

  it("persists an unsaved above-threshold draft via agent/prepare", async () => {
    seedDraft({ unsaved: true });
    useInputDraftStore.setState({ drafts: new Map([[SID, "fix login"]]) }); // 8 non-ws >= 5

    await useSessionStore.getState().commitDraft(SID);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ bonsaiSid: SID, draftInput: "fix login" }),
    );
    expect(useSessionStore.getState().sessions.get(SID)?.unsaved).toBe(false);
  });

  it("autosaves a saved draft via agent/updateDraft (guard does not apply)", async () => {
    seedDraft({ unsaved: false });
    useInputDraftStore.setState({ drafts: new Map([[SID, "ab"]]) }); // sub-threshold, but already saved

    await useSessionStore.getState().commitDraft(SID);

    expect(prepare).not.toHaveBeenCalled();
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ bonsaiSid: SID, draftInput: "ab" }),
    );
  });
});

describe("commitDraft preserves the existing name", () => {
  it("does not relabel a pre-configured draft to the default on flush", async () => {
    // Meta-ticket/stage drafts have a meaningful name and an empty input; a
    // flush (tab switch / blur) must not derive "New session" over it.
    seedDraft({ unsaved: false, name: "Implement: My Ticket" });

    await useSessionStore.getState().commitDraft(SID);

    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ bonsaiSid: SID, name: "Implement: My Ticket" }),
    );
    expect(useSessionStore.getState().sessions.get(SID)?.name).toBe("Implement: My Ticket");
  });

  it("persists a manual rename, not a name derived from the current input", async () => {
    seedDraft({ unsaved: false, name: "WIP", nameManuallySet: true });
    useInputDraftStore.setState({ drafts: new Map([[SID, "totally different prompt text"]]) });

    await useSessionStore.getState().commitDraft(SID);

    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ bonsaiSid: SID, name: "WIP" }),
    );
    expect(useSessionStore.getState().sessions.get(SID)?.name).toBe("WIP");
  });
});
