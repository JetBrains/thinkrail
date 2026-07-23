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
 * stalling those paths wherever that egress is slow or blocked (CI, offline). The one deliberate
 * opt-in to live catalogs is `refreshCatalogsDetached` below (issue #98).
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

/** The slice of `ModelRuntime` the detached refresh needs — tests fake this, no cast required. */
export type CatalogRefreshRuntime = Pick<ModelRuntime, "refresh">;

// One in-flight refresh per runtime instance: pi's `refresh()` does NOT single-flight itself (verified
// vs 0.81.1 — only the availability sub-refresh is queued), and each picker open triggers us again.
const inflightCatalogRefresh = new WeakMap<CatalogRefreshRuntime, Promise<void>>();

// pi's own model-selector refresh budget. With single-flight, a hung refresh must self-expire or it
// would block every future refresh for the host's lifetime.
const CATALOG_REFRESH_TIMEOUT_MS = 15_000;

/**
 * Fire-and-forget model-catalog refresh (issue #98) — the deliberate, detached opt-in to live catalogs
 * over the shared ambient-network-OFF runtime (the per-call `allowNetwork: true` overrides its default).
 * Triggered by `model.list` (the picker read) and nothing else — the caller returns the current
 * snapshot immediately; a later read picks up whatever landed. Mirrors pi's own `/model`.
 *
 * Never awaited, never throws: pi's provider freshness throttle decides whether anything is fetched
 * (no `force`), failures are logged and swallowed, and `PI_OFFLINE` (pi's env convention, also set by
 * the e2e harness for hermeticity) disables it entirely.
 */
export function refreshCatalogsDetached(runtime: CatalogRefreshRuntime): void {
	if (process.env.PI_OFFLINE) return;
	if (inflightCatalogRefresh.has(runtime)) return;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CATALOG_REFRESH_TIMEOUT_MS);
	// The pending abort timer must keep neither a shutting-down host nor a test process alive.
	timer.unref?.();
	const task = runtime
		.refresh({ allowNetwork: true, signal: controller.signal })
		.then((result) => {
			if (result.aborted) {
				// Only our own timeout aborts this signal — say so, or a stuck egress looks like "all fresh".
				console.warn(
					`model catalog refresh timed out after ${CATALOG_REFRESH_TIMEOUT_MS}ms; serving cached catalogs`,
				);
			} else if (result.errors.size > 0) {
				console.warn(
					`model catalog refresh: provider(s) failed: ${[...result.errors.keys()].join(", ")}`,
				);
			}
		})
		.catch((err) => {
			console.warn(`model catalog refresh failed: ${err}`);
		})
		.finally(() => {
			clearTimeout(timer);
			inflightCatalogRefresh.delete(runtime);
		});
	inflightCatalogRefresh.set(runtime, task);
}
