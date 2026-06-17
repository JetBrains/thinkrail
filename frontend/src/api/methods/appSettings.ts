import type { RpcClient } from "../client.ts";
import type { AnalyticsStatus } from "@/types/rpc-methods.ts";

export type { AnalyticsStatus };

/**
 * User-scoped session-creation defaults, served by the backend's
 * AppStore-backed ``appSettings/*`` RPCs. The shape mirrors
 * ``backend/app/core/session_defaults.py:SessionDefaults`` after
 * camelCase serialization.
 */
export interface SessionDefaults {
  model: string;
  permissionMode: string;
  effort: string;
  /** Runtime-declared option toggles, keyed by RuntimeFlag.key. */
  flags?: Record<string, boolean>;
}

export function createAppSettingsApi(client: RpcClient) {
  return {
    getSessionDefaults: () =>
      client.request<SessionDefaults>("appSettings/getSessionDefaults"),

    setSessionDefaults: (cfg: SessionDefaults) =>
      client.request<SessionDefaults>("appSettings/setSessionDefaults", cfg),

    getAnalyticsConsent: () =>
      client.request<AnalyticsStatus>("appSettings/getAnalyticsConsent"),

    setAnalyticsConsent: (enabled: boolean) =>
      client.request<AnalyticsStatus>("appSettings/setAnalyticsConsent", { enabled }),
  };
}

export type AppSettingsApi = ReturnType<typeof createAppSettingsApi>;
