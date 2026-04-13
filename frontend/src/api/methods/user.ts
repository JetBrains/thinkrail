import type { RpcClient } from "../client.ts";

export interface UserProfile {
  userId: string;
  displayName: string;
  createdAt: string | null;
}

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

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
}

/** REST API calls for pre-WebSocket auth (LoginScreen, ProjectPicker). */
export const userRestApi = {
  async getProfile(token: string): Promise<UserProfile | null> {
    const res = await fetch(
      `/api/user/profile?token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return null;
    return res.json();
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

  async getRecentProjects(
    token: string,
    limit = 10
  ): Promise<RecentProject[]> {
    const res = await fetch(
      `/api/user/recent-projects?token=${encodeURIComponent(token)}&limit=${limit}`
    );
    if (!res.ok) return [];
    return res.json();
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
