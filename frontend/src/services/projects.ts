import { restClient } from "@/api/rest.ts";
import type { KnownProject } from "@/api/rest.ts";

export type { KnownProject };

export async function getKnownProjects(): Promise<KnownProject[]> {
  const { data } = await restClient.GET("/api/projects/known");
  return data ?? [];
}

export async function registerKnownProject(
  path: string,
  name: string,
): Promise<void> {
  const { response, error } = await restClient.POST("/api/projects/known", {
    body: { path, name },
  });
  if (!response.ok) {
    const e = error as { detail?: string } | undefined;
    throw new Error(e?.detail ?? "Failed to register known project");
  }
}

export async function removeKnownProject(path: string): Promise<void> {
  const { response, error } = await restClient.DELETE("/api/projects/known", {
    params: { query: { path } },
  });
  if (!response.ok) {
    const e = error as { detail?: string } | undefined;
    throw new Error(e?.detail ?? "Failed to remove known project");
  }
}
