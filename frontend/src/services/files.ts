import { restClient } from "@/api/rest.ts";
import type { FileRead, FileBrowse } from "@/api/rest.ts";

export type { FileRead, FileBrowse };

export async function readFile(
  project: string,
  path: string,
): Promise<FileRead | null> {
  const { data } = await restClient.GET("/api/file/read", {
    params: { query: { project, path } },
  });
  return data ?? null;
}

export async function writeFile(
  project: string,
  path: string,
  content: string,
): Promise<void> {
  await restClient.POST("/api/file/write", {
    body: { project, path, content },
  });
}

export async function browseFiles(): Promise<FileBrowse> {
  const { data } = await restClient.POST("/api/file/browse", {});
  return data ?? { paths: [] };
}

export async function openExternal(
  project: string,
  path: string,
  editor: string,
): Promise<void> {
  await restClient.POST("/api/file/open-external", {
    body: { project, path, editor },
  });
}

/** Returns a URL suitable for use in <img src> or similar. */
export function getFileRawUrl(project: string, path: string): string {
  return `/api/file/raw?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`;
}
