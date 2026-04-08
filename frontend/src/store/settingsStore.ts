import { create } from "zustand";
import { getClient } from "@/api/index.ts";
import { createSettingsApi, type ProjectSettings } from "@/api/methods/settings.ts";
import { type ModelDef, setDynamicModels } from "@/utils/models.ts";

interface SettingsStore {
  /** Parsed project settings from .bonsai/settings.json */
  settings: ProjectSettings | null;
  /** Dynamic model list from backend (null = not yet loaded, use fallback) */
  models: ModelDef[] | null;
  /** Whether a model refresh is in progress */
  refreshing: boolean;

  fetchSettings: () => Promise<void>;
  updateSettings: (patch: Partial<ProjectSettings>) => Promise<void>;
  ensureFile: () => Promise<void>;
  fetchModels: () => Promise<void>;
  refreshModels: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  models: null,
  refreshing: false,

  fetchSettings: async () => {
    try {
      const api = createSettingsApi(getClient());
      const settings = await api.get();
      set({ settings });
    } catch (e) {
      console.error("Failed to fetch settings:", e);
    }
  },

  updateSettings: async (patch) => {
    const current = get().settings;
    const merged = { ...current, ...patch } as ProjectSettings;
    set({ settings: merged }); // optimistic update
    try {
      const api = createSettingsApi(getClient());
      const saved = await api.update(merged);
      set({ settings: saved });
    } catch (e) {
      console.error("Failed to update settings:", e);
      set({ settings: current }); // rollback
    }
  },

  ensureFile: async () => {
    try {
      const api = createSettingsApi(getClient());
      const settings = await api.ensureFile();
      set({ settings });
    } catch (e) {
      console.error("Failed to ensure settings file:", e);
    }
  },

  fetchModels: async () => {
    try {
      const res = await getClient().request<ModelDef[]>("models/list");
      if (res && res.length > 0) {
        set({ models: res });
        setDynamicModels(res);
      }
    } catch (e) {
      // Backend may not have models/list yet — silently fall back
      console.debug("models/list not available, using fallback:", e);
    }
  },

  refreshModels: async () => {
    set({ refreshing: true });
    try {
      const res = await getClient().request<ModelDef[]>("models/refresh");
      if (res && res.length > 0) {
        set({ models: res });
        setDynamicModels(res);
      }
    } catch (e) {
      console.error("Failed to refresh models:", e);
    } finally {
      set({ refreshing: false });
    }
  },
}));
