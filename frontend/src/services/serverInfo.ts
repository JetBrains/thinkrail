import { restClient } from "@/api/rest.ts";
import type { ServerInfo } from "@/api/rest.ts";

export type { ServerInfo };

export async function getServerInfo(): Promise<ServerInfo> {
  const { data } = await restClient.GET("/api/server-info");
  if (!data) throw new Error("Failed to fetch server info");
  return data;
}
