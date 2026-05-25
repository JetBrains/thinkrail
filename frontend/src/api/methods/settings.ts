import type { RpcClient } from "../client.ts";
import type { RuntimeSkillInfo, RuntimeType } from "@/types/agent.ts";

export type VoiceReviseMode = "auto" | "subsession" | "off";

export interface ProjectSettings {
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

    /**
     * List skills exposed by ``IAgentRuntime.list_skills`` for a specific
     * runtime — e.g. Claude Code's user/project/plugin/command/builtin skills.
     *
     * Mirrors the backend ``skills/listRuntime`` RPC (design doc §5.3, §6.5).
     * Wire shape is camelCase via ``RuntimeSkillInfo.model_dump(by_alias=True)``.
     */
    listRuntimeSkills: (runtime: RuntimeType) =>
      client.request<RuntimeSkillInfo[]>("skills/listRuntime", { runtime }),
  };
}

export type SettingsApi = ReturnType<typeof createSettingsApi>;
