import { restClient } from "@/api/rest.ts";
import type { DirList, FolderPick } from "@/api/rest.ts";

export type { DirList, FolderPick };

export async function listDirs(base: string, prefix: string): Promise<DirList> {
  const { data } = await restClient.GET("/api/fs/list-dirs", {
    params: { query: { base, prefix } },
  });
  return data ?? { dirs: [] };
}

export async function makeDirectory(path: string): Promise<void> {
  const { response, error } = await restClient.POST("/api/fs/mkdir", {
    body: { path },
  });
  if (!response.ok) {
    const e = error as { detail?: string } | undefined;
    throw new Error(e?.detail ?? "Failed to create directory");
  }
}

export async function browseFolder(): Promise<FolderPick | null> {
  const { data } = await restClient.GET("/api/fs/browse");
  return data ?? null;
}

/** Default parent directory for new projects (~/ThinkRail). */
export async function getDefaultRoot(): Promise<string> {
  const { data } = await restClient.GET("/api/fs/default-root");
  return data?.root ?? "";
}
