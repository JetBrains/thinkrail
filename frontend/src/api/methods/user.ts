import type { RpcClient } from "../client.ts";
import { restClient } from "../rest.ts";
import type { RecentProject, UserProfile } from "../rest.ts";

export type { UserProfile, RecentProject };

export interface UserPreferences {
  theme?: string;
  soundEnabled?: boolean;
  fontSize?: number;
  compactFontSize?: number;
  leftPanelCollapsed?: boolean;
  rightPanelCollapsed?: boolean;
  leftActiveTab?: string;
  messageHistory?: string[];
  [key: string]: unknown;
}

/** REST API calls for pre-WebSocket auth (LoginScreen, ProjectPicker). */
export const userRestApi = {
  async getProfile(token: string): Promise<UserProfile | null> {
    const { data } = await restClient.GET("/api/user/profile", {
      params: { query: { token } },
    });
    return data ?? null;
  },

  async getPreferences(token: string): Promise<UserPreferences> {
    const res = await fetch(
      `/api/user/preferences?token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return {};
    return res.json();
  },

  async updatePreferences(
    token: string,
    patch: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const res = await fetch(
      `/api/user/preferences?token=${encodeURIComponent(token)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    if (!res.ok) return {};
    return res.json();
  },

  async getRecentProjects(token: string, limit = 10): Promise<RecentProject[]> {
    const { data } = await restClient.GET("/api/user/recent-projects", {
      params: { query: { token, limit } },
    });
    return data ?? [];
  },
};

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
