import { create } from "zustand";
import type { RegistryEntry, SpecDetail, SpecGraph } from "@/types/spec.ts";
import { getClient } from "@/api/index.ts";
import { createSpecApi } from "@/api/methods/specs.ts";

interface SpecStore {
  specs: RegistryEntry[];
  graph: SpecGraph | null;
  specContent: Map<string, string>;
  loading: boolean;
  error: string | null;
  selectedSpecId: string | null;

  fetchSpecs: () => Promise<void>;
  fetchGraph: () => Promise<void>;
  fetchSpecContent: (id: string) => Promise<string>;
  selectSpec: (id: string | null) => void;
  onSpecChanged: (id: string) => void;
  onSpecCreated: (id: string, path: string) => void;
  onSpecDeleted: (id: string) => void;
  onRegistryUpdated: () => void;
}

export const useSpecStore = create<SpecStore>((set, get) => ({
  specs: [],
  graph: null,
  specContent: new Map(),
  loading: false,
  error: null,
  selectedSpecId: null,

  fetchSpecs: async () => {
    set({ loading: true, error: null });
    try {
      const api = createSpecApi(getClient());
      const specs = await api.list();
      console.log("[specStore] Fetched", specs.length, "specs");
      set({ specs: specs as RegistryEntry[], loading: false });
    } catch (e) {
      console.error("[specStore] fetchSpecs error:", e);
      set({ error: (e as Error).message, loading: false });
    }
  },

  fetchGraph: async () => {
    try {
      const api = createSpecApi(getClient());
      const graph = await api.graph();
      set({ graph });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  fetchSpecContent: async (id: string) => {
    const cached = get().specContent.get(id);
    if (cached) return cached;
    const api = createSpecApi(getClient());
    const detail: SpecDetail = await api.get(id);
    const next = new Map(get().specContent);
    next.set(id, detail.content);
    set({ specContent: next });
    return detail.content;
  },

  selectSpec: (id) => set({ selectedSpecId: id }),

  onSpecChanged: (id) => {
    const next = new Map(get().specContent);
    next.delete(id);
    set({ specContent: next });
    get().fetchGraph();
  },

  onSpecCreated: (_id, _path) => {
    get().fetchSpecs();
    get().fetchGraph();
  },

  onSpecDeleted: (id) => {
    const next = new Map(get().specContent);
    next.delete(id);
    set({
      specs: get().specs.filter((s) => s.id !== id),
      specContent: next,
      selectedSpecId: get().selectedSpecId === id ? null : get().selectedSpecId,
    });
    get().fetchGraph();
  },

  onRegistryUpdated: () => {
    get().fetchSpecs();
    get().fetchGraph();
  },
}));
