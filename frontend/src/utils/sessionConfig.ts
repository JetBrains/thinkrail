import { useSettingsStore } from "@/store/settingsStore.ts";
import type { AgentConfig } from "@/types/agent.ts";

/**
 * The four permission modes the agent accepts. Kept as the single source
 * of truth for the picker dropdown (DraftConfigCard) and any validators
 * that gate user input — do not inline this list elsewhere.
 */
export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
] as const;

export type PermissionMode = typeof PERMISSION_MODES[number];

/**
 * Build the AgentConfig used to open a new draft / start a new session.
 *
 * Sources every value from the user-scoped ``sessionDefaults`` record
 * served by the backend's ``appSettings/getSessionDefaults`` RPC. The
 * backend owns the cold-start fallback — the frontend keeps no copy.
 * If the initial fetch is still in flight when the user clicks "+ New",
 * we await it so the draft picks up the configured defaults.
 *
 * Throws when the fetch ultimately resolves to ``null`` (network /
 * backend failure) so callers' existing error handling surfaces it to
 * the user rather than silently substituting hardcoded values.
 */
export async function buildDefaultSessionConfig(): Promise<AgentConfig> {
  const store = useSettingsStore.getState();
  if (store.sessionDefaults === null) {
    await store.fetchSessionDefaults();
  }
  const sd = useSettingsStore.getState().sessionDefaults;
  if (sd === null) {
    throw new Error(
      "Session defaults unavailable: appSettings/getSessionDefaults did not respond. " +
      "Check the backend connection.",
    );
  }
  return {
    model: sd.model,
    maxTurns: sd.maxTurns,
    permissionMode: sd.permissionMode,
    streamText: true,
    effort: sd.effort,
  };
}
