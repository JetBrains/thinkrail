import { restClient } from "@/api/rest.ts";
import type { SetupStatus, SetupResult } from "@/api/rest.ts";

export type { SetupStatus, SetupResult };

export async function getSetupStatus(): Promise<SetupStatus> {
  const { data } = await restClient.GET("/api/setup/status");
  if (!data) throw new Error("Failed to reach server");
  return data;
}

export async function createFirstAdmin(
  userId: string,
  name: string,
): Promise<SetupResult> {
  const { data, error } = await restClient.POST("/api/setup", {
    body: { userId, name },
  });
  if (!data) {
    const e = error as { error?: string; detail?: string } | undefined;
    throw new Error(e?.error ?? e?.detail ?? "Setup failed");
  }
  return data;
}
