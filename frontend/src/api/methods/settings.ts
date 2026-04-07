import type { RpcClient } from "../client.ts";

export interface ProjectSettings {
  default_model: string;
  default_effort: string;
  model_refresh_interval_hours: number;
  [key: string]: unknown;
}

export function createSettingsApi(client: RpcClient) {
  return {
    get: () => client.request<ProjectSettings>("settings/get"),

    update: (settings: ProjectSettings) =>
      client.request<ProjectSettings>("settings/update", { settings }),

    ensureFile: () => client.request<ProjectSettings>("settings/ensureFile"),
  };
}

export type SettingsApi = ReturnType<typeof createSettingsApi>;
