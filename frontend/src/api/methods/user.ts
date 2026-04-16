import type { RpcClient } from "../client.ts";
import type { UserProfile, RecentProject, UserPreferences } from "@/services/user.ts";

export type { UserProfile, RecentProject, UserPreferences };

/** WebSocket RPC methods for in-session preference sync. */
export function createUserApi(client: RpcClient) {
  return {
    getProfile: () => client.request<UserProfile>("user/getProfile"),

    getPreferences: () =>
      client.request<UserPreferences>("user/getPreferences"),

    updatePreferences: (patch: Partial<UserPreferences>) =>
      client.request<UserPreferences>("user/updatePreferences", { patch }),

    getRecentProjects: (limit = 10) =>
      client.request<RecentProject[]>("user/getRecentProjects", { limit }),
  };
}

export type UserApi = ReturnType<typeof createUserApi>;
