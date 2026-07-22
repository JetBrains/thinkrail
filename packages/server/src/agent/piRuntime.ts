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
 * Create the shared runtime from on-disk auth + catalogs (`~/.pi/agent`), with ambient network OFF.
 *
 * Model-catalog reads stay **local** (builtin catalogs + models.json + the persisted models-store),
 * matching the pre-0.80.8 behavior. Without that, every `reloadConfig()`/`refresh()` — i.e. every
 * `provider.status` read and jbcentral connect — would await remote pi.dev catalog checks with **no
 * timeout** (the catalog fetch takes only the caller's signal, and `reloadConfig` passes none),
 * stalling those paths wherever that egress is slow or blocked (CI, offline). A deliberate, detached
 * catalog refresh (explicit `refresh({ allowNetwork: true })`) is tracked in issue #98.
 *
 * HOW it stays local changed under us in pi 0.81: `allowModelNetwork: false` now gates only the
 * create-time refresh, while the runtime's ambient-network default (`modelNetworkEnabled`, what
 * `reloadConfig()` resolves) is derived from **`PI_OFFLINE` at construction** — in 0.80.x the option
 * fed both. So the runtime is constructed under a scoped `PI_OFFLINE` (restored right after — a
 * user-set value is left untouched), which restores the 0.80.x semantics: ambient reads local,
 * network strictly a per-call `allowNetwork: true` opt-in. One-time, at the single creation choke
 * point; pi's other PI_OFFLINE consumers (tool downloads, version checks) never see the override
 * because it's gone before any session exists.
 */
async function createRuntimeOfflineByDefault(): Promise<ModelRuntime> {
	const prior = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	try {
		return await ModelRuntime.create({ allowModelNetwork: false });
	} finally {
		if (prior === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = prior;
	}
}

/** The shared runtime, built lazily on first use (see `createRuntimeOfflineByDefault` for semantics). */
export function getPiRuntime(): Promise<ModelRuntime> {
	if (!runtime) {
		const created = createRuntimeOfflineByDefault();
		runtime = created;
		// A failed create must not brick the host until restart — drop the memo so the next call retries.
		created.catch(() => {
			if (runtime === created) runtime = null;
		});
	}
	return runtime;
}
