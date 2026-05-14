import type { RpcClient } from "../client.ts";

export type VoiceReviseMode = "auto" | "subsession" | "off";

export interface ProjectSettings {
  model_refresh_interval_hours: number;
  event_view: string;
  font_size: number;
  compact_font_size: number;
  voice_revise_mode: VoiceReviseMode;
  [key: string]: unknown;
}

export function createSettingsApi(client: RpcClient) {
  return {
    get: () => client.request<ProjectSettings>("settings/get"),

    update: (settings: ProjectSettings) =>
      client.request<ProjectSettings>("settings/update", { settings }),

    ensureFile: () => client.request<ProjectSettings>("settings/ensureFile"),

    listSkills: () => client.request<Array<{
      id: string;
      name: string;
      description: string;
      icon?: string;
      group?: string;
      requires?: string;
    }>>("skills/list"),
  };
}

export type SettingsApi = ReturnType<typeof createSettingsApi>;
