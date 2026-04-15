import { restClient } from "@/api/rest.ts";
import type { ProjectValidate, ProjectInfo, ProjectFiles } from "@/api/rest.ts";

export type { ProjectFiles };

export async function validateProject(path: string): Promise<ProjectValidate> {
  const { data } = await restClient.GET("/api/project/validate", {
    params: { query: { path } },
  });
  if (!data) throw new Error("Failed to validate project");
  return data;
}

export async function initProject(path: string): Promise<ProjectInfo> {
  const { data, error } = await restClient.POST("/api/project/init", {
    body: { path },
  });
  if (!data) {
    const e = error as { detail?: string } | undefined;
    throw new Error(e?.detail ?? "Failed to initialize project");
  }
  return data;
}

export async function getProjectFiles(
  path: string,
  showHidden = false,
): Promise<ProjectFiles> {
  const { data } = await restClient.GET("/api/project/files", {
    params: { query: { path, show_hidden: showHidden } },
  });
  return data ?? { entries: [] };
}
