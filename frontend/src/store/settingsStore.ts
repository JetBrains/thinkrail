import { create } from "zustand";
import { getClient } from "@/api/index.ts";
import { createSettingsApi, type ProjectSettings } from "@/api/methods/settings.ts";
import { type ModelDef, setDynamicModels } from "@/utils/models.ts";
import { type Skill, FALLBACK_SKILLS } from "@/constants/skills.ts";

/** Models grouped by their owning runtime — the wire shape of `models/list`. */
export interface RuntimeModels {
  runtimeType: string;
  displayName: string;
  models: ModelDef[];
}

interface ListModelsResponse {
  runtimes: RuntimeModels[];
}

interface SettingsStore {
  /** Parsed project settings from .bonsai/settings.json */
  settings: ProjectSettings | null;
  /** Models grouped by runtime (the canonical shape). */
  runtimes: RuntimeModels[] | null;
  /** Flat model list — derived from ``runtimes`` for callers that don't care
   * about the runtime grouping (current picker code). Updated whenever
   * ``runtimes`` changes. */
  models: ModelDef[] | null;
  /** Dynamic skills list from backend (falls back to FALLBACK_SKILLS) */
  skills: Skill[];
  fetchSkills: () => Promise<void>;

  fetchSettings: () => Promise<void>;
  updateSettings: (patch: Partial<ProjectSettings>) => Promise<void>;
  ensureFile: () => Promise<void>;
  fetchModels: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  runtimes: null,
  models: null,
  skills: FALLBACK_SKILLS,

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
      const res = await getClient().request<ListModelsResponse>("models/list");
      const runtimes = res?.runtimes ?? [];
      const flat = runtimes.flatMap((r) => r.models);
      if (flat.length > 0) {
        set({ runtimes, models: flat });
        setDynamicModels(flat);
      }
    } catch (e) {
      // Backend may not have models/list yet — silently fall back.
      // Each runtime owns its own refresh strategy internally; callers
      // don't see freshness metadata or trigger manual refreshes.
      console.debug("models/list not available, using fallback:", e);
    }
  },

  fetchSkills: async () => {
    try {
      const api = createSettingsApi(getClient());
      const raw = await api.listSkills();
      if (raw && raw.length > 0) {
        const skills: Skill[] = raw.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          icon: s.icon ?? "",
          group: s.group ?? "Other",
          requires: s.requires as Skill["requires"],
        }));
        set({ skills });
      }
    } catch (e) {
      console.debug("skills/list not available, using fallback:", e);
    }
  },
}));
