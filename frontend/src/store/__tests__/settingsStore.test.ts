/**
 * Tests for `useSettingsStore.loadRuntimeSkills` + the underlying
 * `createSettingsApi(...).listRuntimeSkills` wire call.
 *
 * Covers design doc §5.3 / §6.5:
 *  - successful round-trip populates `runtimeSkills.get(runtime)`
 *  - failure is silent: the cache entry is left untouched and
 *    `console.debug` is used (matches the existing `fetchSkills`/
 *    `fetchModels` fallback pattern)
 *  - per-runtime caching: independent entries for different runtimes
 *    coexist on the same Map
 *  - API method passes the runtime through as a named param to
 *    `skills/listRuntime` (camelCase wire shape)
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

import { setClient } from "@/api/index.ts";
import { createSettingsApi } from "@/api/methods/settings.ts";
import { useSettingsStore } from "../settingsStore.ts";
import type { RpcClient } from "@/api/client.ts";
import type { RuntimeSkillInfo, RuntimeType } from "@/types/agent.ts";

// ── Test helpers ──────────────────────────────────────────────────────────

interface StubClient {
  request: Mock;
}

function makeStubClient(): StubClient {
  return { request: vi.fn() };
}

function installStubClient(stub: StubClient): void {
  setClient(stub as unknown as RpcClient);
}

const RUNTIME_SKILLS: RuntimeSkillInfo[] = [
  { id: "review", name: "Review", description: "Review a PR", source: "builtin" },
  { id: "init", name: "Init", description: "Init CLAUDE.md", source: "builtin" },
  { id: "user-skill", name: "User skill", description: "User one", source: "user" },
];

// Stand-in for a hypothetical second runtime — the Map keys per runtime, so
// isolation must hold even though only "claude" is registered today.
const OTHER_RUNTIME = "other" as RuntimeType;

beforeEach(() => {
  useSettingsStore.setState({ runtimeSkills: new Map() });
});

// ── API method wiring ─────────────────────────────────────────────────────

describe("createSettingsApi().listRuntimeSkills", () => {
  it("dispatches skills/listRuntime with the runtime as a named param", async () => {
    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(RUNTIME_SKILLS);

    const api = createSettingsApi(stub as unknown as RpcClient);
    const result = await api.listRuntimeSkills("claude");

    expect(stub.request).toHaveBeenCalledTimes(1);
    expect(stub.request).toHaveBeenCalledWith("skills/listRuntime", { runtime: "claude" });
    expect(result).toEqual(RUNTIME_SKILLS);
  });

  it("passes through the camelCase wire shape unchanged", async () => {
    const stub = makeStubClient();
    // The backend serialises ``RuntimeSkillInfo`` with ``by_alias=True`` — the
    // wire keys (id/name/description/source) are already camelCase so the
    // payload round-trips verbatim.
    const payload: RuntimeSkillInfo[] = [
      { id: "specdriven:ticket-specify", name: "Ticket Specify", description: "x", source: "plugin" },
    ];
    stub.request.mockResolvedValueOnce(payload);

    const api = createSettingsApi(stub as unknown as RpcClient);
    const result = await api.listRuntimeSkills("claude");

    expect(result).toEqual(payload);
  });

  it("propagates RPC errors so the caller can decide how to handle them", async () => {
    const stub = makeStubClient();
    stub.request.mockRejectedValueOnce(new Error("Unknown runtime"));

    const api = createSettingsApi(stub as unknown as RpcClient);
    await expect(api.listRuntimeSkills("claude")).rejects.toThrow("Unknown runtime");
  });
});

// ── Store action ──────────────────────────────────────────────────────────

describe("useSettingsStore.loadRuntimeSkills", () => {
  it("populates runtimeSkills.get(runtime) on success", async () => {
    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(RUNTIME_SKILLS);
    installStubClient(stub);

    await useSettingsStore.getState().loadRuntimeSkills("claude");

    const cached = useSettingsStore.getState().runtimeSkills.get("claude");
    expect(cached).toEqual(RUNTIME_SKILLS);
    expect(stub.request).toHaveBeenCalledWith("skills/listRuntime", { runtime: "claude" });
  });

  it("replaces (not mutates) the Map so zustand selectors re-fire", async () => {
    const before = useSettingsStore.getState().runtimeSkills;

    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(RUNTIME_SKILLS);
    installStubClient(stub);

    await useSettingsStore.getState().loadRuntimeSkills("claude");

    const after = useSettingsStore.getState().runtimeSkills;
    expect(after).not.toBe(before);
    expect(after.get("claude")).toEqual(RUNTIME_SKILLS);
  });

  it("treats a null/undefined response as an empty list", async () => {
    const stub = makeStubClient();
    // ``client.request`` is typed as Promise<T> but the JSON layer can in
    // principle resolve with null; assert we don't crash.
    stub.request.mockResolvedValueOnce(null);
    installStubClient(stub);

    await useSettingsStore.getState().loadRuntimeSkills("claude");

    expect(useSettingsStore.getState().runtimeSkills.get("claude")).toEqual([]);
  });

  it("is silent on failure — entry stays absent, console.debug fires", async () => {
    const stub = makeStubClient();
    stub.request.mockRejectedValueOnce(new Error("RPC error -32031: Unknown runtime"));
    installStubClient(stub);

    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    // Should *not* throw.
    await expect(
      useSettingsStore.getState().loadRuntimeSkills("claude"),
    ).resolves.toBeUndefined();

    // Cache entry remains absent — autocomplete falls back to bonsai-only.
    expect(useSettingsStore.getState().runtimeSkills.has("claude")).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("skills/listRuntime"),
      expect.any(Error),
    );

    debugSpy.mockRestore();
  });

  it("preserves prior cache entries when a later runtime load fails", async () => {
    // First call populates "claude".
    const stubOk = makeStubClient();
    stubOk.request.mockResolvedValueOnce(RUNTIME_SKILLS);
    installStubClient(stubOk);
    await useSettingsStore.getState().loadRuntimeSkills("claude");

    // Second call for another runtime fails — the "claude" entry must be untouched.
    const stubErr = makeStubClient();
    stubErr.request.mockRejectedValueOnce(new Error("boom"));
    installStubClient(stubErr);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    await useSettingsStore.getState().loadRuntimeSkills(OTHER_RUNTIME);

    const map = useSettingsStore.getState().runtimeSkills;
    expect(map.get("claude")).toEqual(RUNTIME_SKILLS);
    expect(map.has(OTHER_RUNTIME)).toBe(false);

    debugSpy.mockRestore();
  });

  it("supports multiple runtimes coexisting on the same Map", async () => {
    const claudeSkills = RUNTIME_SKILLS;
    const otherSkills: RuntimeSkillInfo[] = [
      { id: "other-thing", name: "Other Thing", description: "—", source: "builtin" },
    ];

    const stub = makeStubClient();
    stub.request
      .mockResolvedValueOnce(claudeSkills)
      .mockResolvedValueOnce(otherSkills);
    installStubClient(stub);

    await useSettingsStore.getState().loadRuntimeSkills("claude");
    await useSettingsStore.getState().loadRuntimeSkills(OTHER_RUNTIME);

    const map = useSettingsStore.getState().runtimeSkills;
    expect(map.get("claude")).toEqual(claudeSkills);
    expect(map.get(OTHER_RUNTIME)).toEqual(otherSkills);
  });

  it("overwrites the entry on a successful re-fetch for the same runtime", async () => {
    const first = RUNTIME_SKILLS;
    const second: RuntimeSkillInfo[] = [
      { id: "new", name: "New", description: "freshly installed plugin", source: "plugin" },
    ];

    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    installStubClient(stub);

    await useSettingsStore.getState().loadRuntimeSkills("claude");
    expect(useSettingsStore.getState().runtimeSkills.get("claude")).toEqual(first);

    await useSettingsStore.getState().loadRuntimeSkills("claude");
    expect(useSettingsStore.getState().runtimeSkills.get("claude")).toEqual(second);
  });
});
