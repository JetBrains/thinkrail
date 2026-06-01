/**
 * Tests for `useRuntimeCapsStore` and the underlying `createRuntimesApi`
 * wire calls (`runtimes/list`, `runtimes/capabilities`).
 *
 *  - fetchRuntimes / fetchCapabilities populate the store on success
 *  - fetchCapabilities is keyed per-runtime and overwrites on re-fetch
 *  - failure is silent: the store is left untouched, console.debug fires
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

import { setClient } from "@/api/index.ts";
import { createRuntimesApi } from "@/api/methods/runtimes.ts";
import { useRuntimeCapsStore } from "../runtimeCapsStore.ts";
import type { RpcClient } from "@/api/client.ts";
import type { RuntimeCapabilities, RuntimesListResponse } from "@/types/rpc-methods.ts";

interface StubClient {
  request: Mock;
}

function makeStubClient(): StubClient {
  return { request: vi.fn() };
}

function installStubClient(stub: StubClient): void {
  setClient(stub as unknown as RpcClient);
}

const CLAUDE_CAPS: RuntimeCapabilities = {
  permissionModes: [
    { value: "default", label: "default" },
    { value: "plan", label: "plan" },
  ],
  effortLevels: [
    { value: "auto", label: "auto" },
    { value: "high", label: "high" },
  ],
  models: [
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  ],
};

const RUNTIMES: RuntimesListResponse = {
  runtimes: [{ runtimeType: "claude", displayName: "Claude Code" }],
};

beforeEach(() => {
  useRuntimeCapsStore.setState({ runtimes: null, capsByRuntime: {} });
});

describe("createRuntimesApi", () => {
  it("dispatches runtimes/list with no params", async () => {
    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(RUNTIMES);
    const api = createRuntimesApi(stub as unknown as RpcClient);

    const result = await api.list();

    expect(stub.request).toHaveBeenCalledWith("runtimes/list");
    expect(result).toEqual(RUNTIMES);
  });

  it("dispatches runtimes/capabilities with the runtimeType param", async () => {
    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(CLAUDE_CAPS);
    const api = createRuntimesApi(stub as unknown as RpcClient);

    const result = await api.capabilities("claude");

    expect(stub.request).toHaveBeenCalledWith("runtimes/capabilities", { runtimeType: "claude" });
    expect(result).toEqual(CLAUDE_CAPS);
  });
});

describe("useRuntimeCapsStore.fetchRuntimes", () => {
  it("populates the runtimes identity list", async () => {
    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(RUNTIMES);
    installStubClient(stub);

    await useRuntimeCapsStore.getState().fetchRuntimes();

    expect(useRuntimeCapsStore.getState().runtimes).toEqual(RUNTIMES.runtimes);
  });

  it("is silent on failure — runtimes stays null, console.debug fires", async () => {
    const stub = makeStubClient();
    stub.request.mockRejectedValueOnce(new Error("boom"));
    installStubClient(stub);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    await expect(useRuntimeCapsStore.getState().fetchRuntimes()).resolves.toBeUndefined();

    expect(useRuntimeCapsStore.getState().runtimes).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("runtimes/list"), expect.any(Error));
    debugSpy.mockRestore();
  });
});

describe("useRuntimeCapsStore.fetchCapabilities", () => {
  it("caches caps under the runtime key", async () => {
    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(CLAUDE_CAPS);
    installStubClient(stub);

    await useRuntimeCapsStore.getState().fetchCapabilities("claude");

    expect(useRuntimeCapsStore.getState().capsByRuntime.claude).toEqual(CLAUDE_CAPS);
  });

  it("overwrites the entry on re-fetch (idempotent refresh)", async () => {
    const updated: RuntimeCapabilities = {
      ...CLAUDE_CAPS,
      models: [{ value: "claude-opus-4-9", label: "Opus 4.9" }],
    };
    const stub = makeStubClient();
    stub.request.mockResolvedValueOnce(CLAUDE_CAPS).mockResolvedValueOnce(updated);
    installStubClient(stub);

    await useRuntimeCapsStore.getState().fetchCapabilities("claude");
    expect(useRuntimeCapsStore.getState().capsByRuntime.claude).toEqual(CLAUDE_CAPS);

    await useRuntimeCapsStore.getState().fetchCapabilities("claude");
    expect(useRuntimeCapsStore.getState().capsByRuntime.claude).toEqual(updated);
  });

  it("is silent on failure — the cache entry is left absent", async () => {
    const stub = makeStubClient();
    stub.request.mockRejectedValueOnce(new Error("RPC error -32031"));
    installStubClient(stub);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    await expect(
      useRuntimeCapsStore.getState().fetchCapabilities("claude"),
    ).resolves.toBeUndefined();

    expect(useRuntimeCapsStore.getState().capsByRuntime.claude).toBeUndefined();
    debugSpy.mockRestore();
  });
});
