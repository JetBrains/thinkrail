import { useSettingsStore } from "@/store/settingsStore.ts";
import type { AgentConfig } from "@/types/agent.ts";

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
    permissionMode: sd.permissionMode,
    streamText: true,
    effort: sd.effort,
    flags: sd.flags ?? {},
  };
}
