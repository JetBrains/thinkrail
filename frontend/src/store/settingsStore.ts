import { create } from "zustand";
import { getClient } from "@/api/index.ts";
import { createSettingsApi, type ProjectSettings } from "@/api/methods/settings.ts";
import { createAppSettingsApi, type SessionDefaults } from "@/api/methods/appSettings.ts";
import { type Skill, FALLBACK_SKILLS } from "@/constants/skills.ts";
import type { RuntimeSkillInfo, RuntimeType } from "@/types/agent.ts";

interface SettingsStore {
  /** Parsed project settings from .tr/settings.json */
  settings: ProjectSettings | null;
  /** User-scoped session-creation defaults (AppStore-backed). */
  sessionDefaults: SessionDefaults | null;
  /** Dynamic skills list from backend (falls back to FALLBACK_SKILLS) */
  skills: Skill[];
  fetchSkills: () => Promise<void>;
  /**
   * Per-runtime cache of skills exposed by `IAgentRuntime.list_skills()`
   * (e.g. Claude Code plugin/command skills). Populated by
   * `loadRuntimeSkills`; defaults to an empty Map so consumers like
   * `useSlashAutocomplete` can safely read it before the action runs.
   */
  runtimeSkills: Map<RuntimeType, RuntimeSkillInfo[]>;
  /**
   * Fetch runtime skills for ``runtime`` via ``skills/listRuntime`` and
   * cache them on the store. Silent on failure — logs to ``console.debug``
   * and leaves the cache entry untouched, so the autocomplete popup
   * gracefully falls back to a ThinkRail-only list (design doc §6.5, §7).
   */
  loadRuntimeSkills: (runtime: RuntimeType) => Promise<void>;

  fetchSettings: () => Promise<void>;
  updateSettings: (patch: Partial<ProjectSettings>) => Promise<void>;
  ensureFile: () => Promise<void>;
  fetchSessionDefaults: () => Promise<void>;
  updateSessionDefaults: (patch: Partial<SessionDefaults>) => Promise<SessionDefaults>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  sessionDefaults: null,
  skills: FALLBACK_SKILLS,
  runtimeSkills: new Map(),

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

  fetchSessionDefaults: async () => {
    try {
      const api = createAppSettingsApi(getClient());
      const sessionDefaults = await api.getSessionDefaults();
      set({ sessionDefaults });
    } catch (e) {
      console.error("Failed to fetch session defaults:", e);
    }
  },

  updateSessionDefaults: async (patch) => {
    const current = get().sessionDefaults;
    if (!current) {
      throw new Error("Cannot update session defaults before they have loaded");
    }
    const merged: SessionDefaults = { ...current, ...patch };
    set({ sessionDefaults: merged }); // optimistic
    try {
      const api = createAppSettingsApi(getClient());
      const saved = await api.setSessionDefaults(merged);
      set({ sessionDefaults: saved });
      return saved;
    } catch (e) {
      console.error("Failed to update session defaults:", e);
      set({ sessionDefaults: current }); // rollback
      throw e;
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

  loadRuntimeSkills: async (runtime) => {
    try {
      const api = createSettingsApi(getClient());
      const list = await api.listRuntimeSkills(runtime);
      // Replace the Map (not mutate) so zustand selectors re-fire.
      const next = new Map(get().runtimeSkills);
      next.set(runtime, list ?? []);
      set({ runtimeSkills: next });
    } catch (e) {
      // Silent fallback per design doc §6.5 / §7 — the popup omits the
      // runtime section without an error toast or inline warning.
      console.debug("skills/listRuntime not available, omitting runtime section:", e);
    }
  },
}));
