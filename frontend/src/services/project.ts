import { restClient } from "@/api/rest.ts";
import type {
  InitEngineResult,
  ProjectValidate,
  ProjectFiles,
  ProjectScan,
} from "@/api/rest.ts";

export type { ProjectFiles, ProjectScan, InitEngineResult };

export async function validateProject(path: string): Promise<ProjectValidate> {
  const { data } = await restClient.GET("/api/project/validate", {
    params: { query: { path } },
  });
  if (!data) throw new Error("Failed to validate project");
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

export async function scanProject(path: string): Promise<ProjectScan> {
  const { data } = await restClient.GET("/api/project/scan", {
    params: { query: { path } },
  });
  return data ?? { important_files: [], top_folders: [], engine_guidance: [] };
}

export async function initEngine(
  engine: string,
  path: string,
): Promise<InitEngineResult> {
  const { data, error } = await restClient.POST("/api/project/init-engine", {
    body: { engine, path },
  });
  if (error || !data) {
    throw new Error(
      typeof error === "object" && error && "detail" in error
        ? String((error as { detail: unknown }).detail)
        : "Failed to init engine",
    );
  }
  return data;
}
