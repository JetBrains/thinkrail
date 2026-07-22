import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * The shared pi model/auth runtime — one `ModelRuntime` for every session (pi's canonical SDK facade
 * since 0.80.8: models, credentials, availability, login/logout, and request dispatch in one object).
 * Built lazily on first use so `PI_CODING_AGENT_DIR` set before that point is honored (tests and the
 * e2e harnesses rely on this), and memoized as a promise because `ModelRuntime.create()` is async.
 */
let runtime: Promise<ModelRuntime> | null = null;

/** Override the shared runtime — tests inject a faux-backed one so no auth/network is needed. */
export function configurePiRuntime(rt: ModelRuntime | null): void {
	runtime = rt ? Promise.resolve(rt) : null;
}

/**
 * The shared runtime, built lazily from on-disk auth + catalogs (`~/.pi/agent`).
 *
 * `allowModelNetwork: false`: model-catalog reads stay **local** (builtin catalogs + models.json +
 * the persisted models-store), matching the pre-0.80.8 behavior. Without it, every
 * `reloadConfig()`/`refresh()` — i.e. every `provider.status` read and jbcentral connect — would await
 * remote pi.dev catalog checks with **no timeout** (only `ModelRuntime.create` guards its initial
 * refresh), stalling those paths wherever that egress is slow or blocked (CI, offline). A deliberate,
 * detached catalog refresh (explicit `refresh({ allowNetwork: true })`) is tracked in issue #98.
 */
export function getPiRuntime(): Promise<ModelRuntime> {
	if (!runtime) {
		const created = ModelRuntime.create({ allowModelNetwork: false });
		runtime = created;
		// A failed create must not brick the host until restart — drop the memo so the next call retries.
		created.catch(() => {
			if (runtime === created) runtime = null;
		});
	}
	return runtime;
}
