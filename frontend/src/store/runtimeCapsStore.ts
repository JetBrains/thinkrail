import { create } from "zustand";
import { getClient } from "@/api/index.ts";
import { createRuntimesApi } from "@/api/methods/runtimes.ts";
import type { RuntimeType } from "@/types/agent.ts";
import type { RuntimeCapabilities, RuntimeIdentity } from "@/types/rpc-methods.ts";

interface RuntimeCapsStore {
  /** Registered runtimes (identity only), from `runtimes/list`. */
  runtimes: RuntimeIdentity[] | null;
  /** Per-runtime capability declaration, from `runtimes/capabilities`. */
  capsByRuntime: Record<string, RuntimeCapabilities>;

  /** Fetch the runtime identity list. Silent on failure. */
  fetchRuntimes: () => Promise<void>;
  /**
   * Fetch one runtime's capabilities and cache it. Idempotent: re-fetching
   * refreshes the cached entry; callers may fire it on boot without guarding.
   * Silent on failure (leaves any existing entry untouched).
   */
  fetchCapabilities: (runtime: RuntimeType) => Promise<void>;
}

export const useRuntimeCapsStore = create<RuntimeCapsStore>((set, get) => ({
  runtimes: null,
  capsByRuntime: {},

  fetchRuntimes: async () => {
    try {
      const api = createRuntimesApi(getClient());
      const res = await api.list();
      set({ runtimes: res?.runtimes ?? [] });
    } catch (e) {
      console.debug("runtimes/list not available:", e);
    }
  },

  fetchCapabilities: async (runtime) => {
    try {
      const api = createRuntimesApi(getClient());
      const caps = await api.capabilities(runtime);
      set({ capsByRuntime: { ...get().capsByRuntime, [runtime]: caps } });
    } catch (e) {
      console.debug(`runtimes/capabilities(${runtime}) not available:`, e);
    }
  },
}));
