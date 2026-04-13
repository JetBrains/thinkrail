/**
 * Syncs user preferences to the backend via RPC.
 *
 * Call `syncPref(patch)` to asynchronously send a partial update.
 * Fails silently — preferences are best-effort.
 */

let _client: { request: (method: string, params?: object) => Promise<unknown> } | null = null;

export function setPrefSyncClient(client: typeof _client) {
  _client = client;
}

export function syncPref(patch: Record<string, unknown>) {
  if (!_client) return;
  _client.request("user/updatePreferences", { patch }).catch(() => {
    // Silently ignore — preference sync is best-effort
  });
}
