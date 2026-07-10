// The post-change refresh: pull auth.json + models.json back off disk into the shared runtime, then
// broadcast the `changed` invalidation so every client re-fetches `auth.status` + `model.list`.
// This is what closes the gate reactively the moment a provider lands.

import { getPiRuntime } from "../agent";
import { publishAuthEvent } from "./events";

/** Reload the shared pi runtime from disk and broadcast `changed`. Returns the new model count. */
export function refreshAuthAndModels(): number {
	const { authStorage, modelRegistry } = getPiRuntime();
	authStorage.reload();
	modelRegistry.refresh();
	const modelCount = modelRegistry.getAvailable().length;
	publishAuthEvent({ kind: "changed", modelCount });
	return modelCount;
}
