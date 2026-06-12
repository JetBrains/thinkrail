// @vitest-environment jsdom
/**
 * Draft-on-type (lazy persistence) tests for sessionStore.
 *
 * Covers DRAFT_SESSION_DESIGN.md § Draft-on-Type and the state-management
 * spec's draft-on-type bullet:
 *   - createNewSession defers (no agent/prepare) and inserts an unsaved draft;
 *     a second untouched blank focuses the existing tab.
 *   - ensureSaved is single-flight and reuses the minted id.
 *   - updateDraft skips the RPC while unsaved, calls it once saved.
 *   - clearing text after a save reverts the name and keeps the draft.
 *   - restore repopulates inputDraftStore from draftInput.
 *   - scope guard: createDraft and the agent/run path persist immediately.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

import { setClient } from "@/api/index.ts";
import type { RpcClient } from "@/api/client.ts";
import { useSessionStore } from "../sessionStore.ts";
import { useInputDraftStore } from "../inputDraftStore.ts";
import { useSettingsStore } from "../settingsStore.ts";
import { DEFAULT_SESSION_NAME } from "@/utils/sessionName.ts";

// ── Stub RPC client ─────────────────────────────────────────────────────────

interface StubClient {
  request: Mock;
}

function makeStubClient(
  routes: Record<string, (params: Record<string, unknown>) => unknown> = {},
): StubClient {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const handler = routes[method];
    if (handler) return handler(params);
    // Sensible defaults for the draft RPCs so unrouted calls don't reject.
    if (method === "agent/prepare") return { thinkrailSid: params.thinkrailSid, systemPrompt: "SP", sections: [] };
    if (method === "agent/updateDraft") return { systemPrompt: "SP", sections: [] };
    if (method === "agent/run") return { thinkrailSid: "server-run-id" };
    if (method === "agent/startDraft") return { thinkrailSid: params.thinkrailSid };
    if (method === "session/list") return [];
    if (method === "session/get") return null;
    return null;
  });
  return { request };
}

function install(stub: StubClient): void {
  setClient(stub as unknown as RpcClient);
}

function callsTo(stub: StubClient, method: string): Record<string, unknown>[] {
  return stub.request.mock.calls
    .filter((c) => c[0] === method)
    .map((c) => (c[1] ?? {}) as Record<string, unknown>);
}

function seedDefaults(): void {
  useSettingsStore.setState({
    sessionDefaults: {
      model: "claude-sonnet-4-6",
      permissionMode: "default",
      effort: "auto",
      flags: {},
    },
  });
}

function resetStore(): void {
  useSessionStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    openTabs: new Set(),
    closedIds: new Set(),
  });
  useInputDraftStore.setState({ drafts: new Map() });
}

beforeEach(() => {
  resetStore();
  seedDefaults();
});

// ── createNewSession (defer + no-duplicate-blanks) ──────────────────────────

describe("createNewSession (defer)", () => {
  it("issues no agent/prepare and inserts an unsaved draft", async () => {
    const stub = makeStubClient();
    install(stub);

    const sid = await useSessionStore.getState().createNewSession();

    expect(callsTo(stub, "agent/prepare")).toHaveLength(0);
    expect(callsTo(stub, "agent/run")).toHaveLength(0);

    const session = useSessionStore.getState().sessions.get(sid);
    expect(session).toBeDefined();
    expect(session!.status).toBe("draft");
    expect(session!.unsaved).toBe(true);
    expect(session!.name).toBe(DEFAULT_SESSION_NAME);
    expect(useSessionStore.getState().openTabs.has(sid)).toBe(true);
    expect(useSessionStore.getState().activeSessionId).toBe(sid);
  });

  it("focuses the existing untouched blank tab on a second trigger (no second session)", async () => {
    const stub = makeStubClient();
    install(stub);

    const first = await useSessionStore.getState().createNewSession();
    // Switch active away to prove the second call re-focuses the blank.
    useSessionStore.setState({ activeSessionId: null });

    const second = await useSessionStore.getState().createNewSession();

    expect(second).toBe(first);
    expect(useSessionStore.getState().sessions.size).toBe(1);
    expect(useSessionStore.getState().activeSessionId).toBe(first);
    expect(callsTo(stub, "agent/prepare")).toHaveLength(0);
  });

  it("does NOT focus a blank that already has typed text — opens a fresh draft", async () => {
    const stub = makeStubClient();
    install(stub);

    const first = await useSessionStore.getState().createNewSession();
    useInputDraftStore.getState().setDraft(first, "hello there");

    const second = await useSessionStore.getState().createNewSession();

    expect(second).not.toBe(first);
    expect(useSessionStore.getState().sessions.size).toBe(2);
  });
});

// ── ensureSaved (single-flight, reuse minted id) ────────────────────────────

describe("ensureSaved", () => {
  it("is single-flight: concurrent callers trigger exactly one agent/prepare", async () => {
    let resolvePrepare: (v: unknown) => void = () => {};
    const stub = makeStubClient({
      "agent/prepare": (params) =>
        new Promise((resolve) => {
          resolvePrepare = () => resolve({ thinkrailSid: params.thinkrailSid, systemPrompt: "SP", sections: [] });
        }),
    });
    install(stub);

    const sid = await useSessionStore.getState().createNewSession();
    useInputDraftStore.getState().setDraft(sid, "fix login flow");

    const p1 = useSessionStore.getState().ensureSaved(sid);
    const p2 = useSessionStore.getState().ensureSaved(sid);

    resolvePrepare(undefined);
    await Promise.all([p1, p2]);

    const prepareCalls = callsTo(stub, "agent/prepare");
    expect(prepareCalls).toHaveLength(1);
    // The minted id is reused verbatim, never reconciled.
    expect(prepareCalls[0].thinkrailSid).toBe(sid);
    expect(prepareCalls[0].draftInput).toBe("fix login flow");

    const session = useSessionStore.getState().sessions.get(sid);
    expect(session!.unsaved).toBe(false);
    expect(session!.systemPrompt).toBe("SP");
  });

  it("resolves immediately and makes no RPC when already saved", async () => {
    const stub = makeStubClient();
    install(stub);
    const sid = await useSessionStore.getState().createNewSession();
    useInputDraftStore.getState().setDraft(sid, "enough text");
    await useSessionStore.getState().ensureSaved(sid);
    stub.request.mockClear();

    await useSessionStore.getState().ensureSaved(sid);
    expect(callsTo(stub, "agent/prepare")).toHaveLength(0);
  });
});

// ── updateDraft (local-only while unsaved) ──────────────────────────────────

describe("updateDraft", () => {
  it("skips the RPC while unsaved and applies config locally", async () => {
    const stub = makeStubClient();
    install(stub);
    const sid = await useSessionStore.getState().createNewSession();

    await useSessionStore.getState().updateDraft(sid, { specIds: ["spec-a"] });

    expect(callsTo(stub, "agent/updateDraft")).toHaveLength(0);
    expect(useSessionStore.getState().sessions.get(sid)!.specIds).toEqual(["spec-a"]);
  });

  it("calls agent/updateDraft once the draft is saved", async () => {
    const stub = makeStubClient();
    install(stub);
    const sid = await useSessionStore.getState().createNewSession();
    useInputDraftStore.getState().setDraft(sid, "enough text");
    await useSessionStore.getState().ensureSaved(sid);

    await useSessionStore.getState().updateDraft(sid, { specIds: ["spec-b"] });

    const calls = callsTo(stub, "agent/updateDraft");
    expect(calls).toHaveLength(1);
    expect(calls[0].specIds).toEqual(["spec-b"]);
  });
});

// ── Clearing text after a save ──────────────────────────────────────────────

describe("noteDraftInput clearing after save", () => {
  it("reverts the name to the default and does NOT delete the draft", async () => {
    const stub = makeStubClient();
    install(stub);
    const sid = await useSessionStore.getState().createNewSession();
    useInputDraftStore.getState().setDraft(sid, "fix login flow");
    useSessionStore.getState().noteDraftInput(sid, "fix login flow");
    await useSessionStore.getState().ensureSaved(sid);

    expect(useSessionStore.getState().sessions.get(sid)!.name).toBe("fix login flow");

    // Clear all text on the saved draft.
    useInputDraftStore.getState().setDraft(sid, "");
    useSessionStore.getState().noteDraftInput(sid, "");

    const session = useSessionStore.getState().sessions.get(sid);
    expect(session).toBeDefined();
    expect(session!.unsaved).toBe(false);
    expect(session!.name).toBe(DEFAULT_SESSION_NAME);
  });

  it("freezes derivation after a manual rename", async () => {
    const stub = makeStubClient();
    install(stub);
    const sid = await useSessionStore.getState().createNewSession();
    await useSessionStore.getState().renameDraft(sid, "my name");

    useSessionStore.getState().noteDraftInput(sid, "completely different prompt");

    expect(useSessionStore.getState().sessions.get(sid)!.name).toBe("my name");
  });
});

// ── Scope guard: pre-configured drafts ──────────────────────────────────────

describe("createDraft name handling", () => {
  beforeEach(() => seedDefaults());

  it("freezes derivation for a pre-configured draft with a meaningful name", async () => {
    install(makeStubClient({ "agent/prepare": () => ({ thinkrailSid: "pre-1", systemPrompt: "SP", sections: [] }) }));
    const sid = await useSessionStore.getState().createNewSession({
      skillId: "ticket-implement",
      name: "Implement: My Ticket",
    });

    const session = useSessionStore.getState().sessions.get(sid);
    expect(session?.unsaved).toBeFalsy();
    expect(session?.nameManuallySet).toBe(true);

    // Typing into it must not relabel the intentional name.
    useSessionStore.getState().noteDraftInput(sid, "some prompt the user typed");
    expect(useSessionStore.getState().sessions.get(sid)?.name).toBe("Implement: My Ticket");
  });

  it("leaves derivation enabled for a pre-configured draft with the default name", async () => {
    install(makeStubClient({ "agent/prepare": () => ({ thinkrailSid: "pre-2", systemPrompt: "SP", sections: [] }) }));
    const sid = await useSessionStore.getState().createNewSession({ skillId: "some-skill" });

    expect(useSessionStore.getState().sessions.get(sid)?.nameManuallySet).toBeFalsy();
  });
});

// ── Restore repopulation ────────────────────────────────────────────────────

describe("restore repopulates inputDraftStore", () => {
  it("loadActiveSessions seeds the input box from draftInput", async () => {
    const entry = {
      thinkrailSid: "draft-sid",
      name: "fix login flow",
      specIds: [],
      status: "draft",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      active: true,
      inTracker: true,
      draftInput: "fix login flow",
      config: { model: "claude-sonnet-4-6", permissionMode: "default" },
    };
    const stub = makeStubClient({
      "session/list": () => [entry],
      "session/get": () => ({
        thinkrailSid: "draft-sid",
        name: "fix login flow",
        specIds: [],
        config: { model: "claude-sonnet-4-6", permissionMode: "default" },
        status: "draft",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        events: [],
      }),
    });
    install(stub);

    await useSessionStore.getState().loadActiveSessions();

    expect(useInputDraftStore.getState().getDraft("draft-sid")).toBe("fix login flow");
    expect(useSessionStore.getState().sessions.get("draft-sid")!.name).toBe("fix login flow");
  });

  it("restores the rename freeze for a draft whose input was cleared", async () => {
    const entry = {
      thinkrailSid: "draft-empty",
      name: "WIP", // meaningful name, empty input (text cleared after a save)
      specIds: [],
      status: "draft",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      active: true,
      inTracker: true,
      draftInput: "",
      config: { model: "claude-sonnet-4-6", permissionMode: "default" },
    };
    const stub = makeStubClient({
      "session/list": () => [entry],
      "session/get": () => ({
        thinkrailSid: "draft-empty",
        name: "WIP",
        specIds: [],
        config: { model: "claude-sonnet-4-6", permissionMode: "default" },
        status: "draft",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        events: [],
      }),
    });
    install(stub);

    await useSessionStore.getState().loadActiveSessions();

    const session = useSessionStore.getState().sessions.get("draft-empty");
    expect(session?.name).toBe("WIP");
    expect(session?.nameManuallySet).toBe(true);

    useSessionStore.getState().noteDraftInput("draft-empty", "a new prompt the user types");
    expect(useSessionStore.getState().sessions.get("draft-empty")?.name).toBe("WIP");
  });
});

// ── Scope guard ─────────────────────────────────────────────────────────────

describe("scope guard (immediate persist preserved)", () => {
  it("createDraft persists immediately via agent/prepare", async () => {
    const stub = makeStubClient();
    install(stub);

    await useSessionStore.getState().createDraft({
      specIds: ["spec-x"],
      config: { model: "claude-sonnet-4-6", permissionMode: "default", streamText: true, effort: "auto", flags: {} },
      name: "preconfigured",
    });

    expect(callsTo(stub, "agent/prepare")).toHaveLength(1);
    // createDraft does not pass a client-minted thinkrailSid — the server mints.
    expect(callsTo(stub, "agent/prepare")[0].thinkrailSid).toBeUndefined();
  });

  it("the agent/run (Suggested) path persists immediately", async () => {
    const stub = makeStubClient({ "agent/run": () => ({ thinkrailSid: "run-sid" }) });
    install(stub);

    await useSessionStore.getState().startSession({
      specIds: ["spec-y"],
      config: { model: "claude-sonnet-4-6", permissionMode: "default", streamText: true, effort: "auto", flags: {} },
      name: "suggested",
    });

    expect(callsTo(stub, "agent/run")).toHaveLength(1);
    const session = useSessionStore.getState().sessions.get("run-sid");
    expect(session).toBeDefined();
    expect(session!.unsaved).toBeUndefined();
  });
});
