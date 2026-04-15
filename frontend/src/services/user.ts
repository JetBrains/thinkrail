import { restClient } from "@/api/rest.ts";
import type { UserProfile, RecentProject } from "@/api/rest.ts";

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

export async function getUserProfile(token: string): Promise<UserProfile | null> {
  const { data } = await restClient.GET("/api/user/profile", {
    params: { query: { token } },
  });
  return data ?? null;
}

export async function getUserPreferences(token: string): Promise<UserPreferences> {
  const { data } = await restClient.GET("/api/user/preferences", {
    params: { query: { token } },
  });
  return (data as UserPreferences | undefined) ?? {};
}

export async function updateUserPreferences(
  token: string,
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const { data } = await restClient.PUT("/api/user/preferences", {
    params: { query: { token } },
    body: patch,
  });
  return (data as UserPreferences | undefined) ?? {};
}

export async function getRecentProjects(
  token: string,
  limit = 10,
): Promise<RecentProject[]> {
  const { data } = await restClient.GET("/api/user/recent-projects", {
    params: { query: { token, limit } },
  });
  return data ?? [];
}
