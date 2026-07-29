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
 * matching the pre-0.80.8 behavior. Without that, every no-options `refresh()` (pi 0.82 folded the
 * old `reloadConfig()` into it) — i.e. every `provider.status` read and jbcentral connect — would
 * await remote pi.dev catalog checks with **no timeout** (the catalog fetch takes only the caller's
 * signal, and those callers pass none), stalling those paths wherever that egress is slow or blocked
 * (CI, offline). The one deliberate opt-in to live catalogs is `refreshCatalogsDetached` below
 * (issue #98).
 *
 * HOW it stays local changed under us in pi 0.81: `allowModelNetwork: false` now gates only the
 * create-time refresh, while the runtime's ambient-network default (`modelNetworkEnabled`, what a
 * no-options `refresh()` resolves) is derived from **`PI_OFFLINE` at construction** — in 0.80.x the
 * option fed both. So the runtime is constructed under a scoped `PI_OFFLINE` (restored right after — a
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

/** The slice of `ModelRuntime` a settled-models read needs — tests fake this, no cast required. */
export type AvailableModelsRuntime = Pick<ModelRuntime, "getAvailableSnapshot">;

/**
 * pi's **settled** available-models snapshot — the single read every host path uses (the picker's
 * universe, the default resolution, and every inbound model-ref check, so they can never disagree).
 *
 * Deliberately **not** `runtime.getAvailable()`: that awaits `refreshAvailability()`, which returns the
 * pending availability pass *or starts a new one*, and that pass is pi's unsignalled per-provider auth
 * fan-out (`checkAuth` per provider — where a stalled local provider lives). Awaiting it would hand every
 * read an unbounded wait, `model.list` included, whose whole contract is to answer without touching the
 * network — and it would escape `refreshCatalogs`' deadline one line after it was applied. The snapshot is
 * pi's own result of that fan-out, written at `create()` (which awaits a refresh), after every `refresh()`,
 * and on login/logout: what the last *settled* pass concluded, which is exactly what a caller may serve.
 */
export function settledAvailableModels(
	runtime: AvailableModelsRuntime,
): ReturnType<ModelRuntime["getAvailableSnapshot"]> {
	return runtime.getAvailableSnapshot();
}

/** The slice of `ModelRuntime` the detached refresh needs — tests fake this, no cast required. */
export type CatalogRefreshRuntime = Pick<ModelRuntime, "refresh">;

/** What a caller learns from awaiting a refresh: whether the pass it waited on settled inside the budget
 * (a timed-out caller is served the registry as it stands — current, but nobody's verdict). */
export interface CatalogRefreshOutcome {
	completed: boolean;
}

// One in-flight refresh per runtime instance: pi's `refresh()` does NOT single-flight itself (verified
// only the availability sub-refresh is queued), and each picker open triggers us again.
// `force` is tracked alongside the task because the two kinds are not interchangeable: a throttled pass
// cannot satisfy a caller that asked to bypass the throttle.
const inflightCatalogRefresh = new WeakMap<
	CatalogRefreshRuntime,
	{ task: Promise<void>; force: boolean }
>();

// pi's own model-selector refresh budget, applied twice over: as `models.refresh`'s abort signal (with
// single-flight, a hung refresh must self-expire or it would block every future refresh for the host's
// lifetime) and as the ceiling on what a *caller* awaits (`withDeadline`) — the signal alone does not
// bound a pass, let alone a queued one.
const CATALOG_REFRESH_TIMEOUT_MS = 15_000;

/**
 * The model-catalog refresh (issue #98) — the deliberate opt-in to live catalogs over the shared
 * ambient-network-OFF runtime (the per-call `allowNetwork: true` overrides its default). Mirrors pi's
 * own `/model`. Two kinds of caller:
 *
 * - **throttled** (default): pi's provider freshness window decides whether anything is fetched. pi
 *   returns early inside that window — *before* it issues any request at all, `If-None-Match`
 *   revalidation included — so an implicit trigger (`model.list`, opening the picker) costs nothing and
 *   usually changes nothing.
 * - **`force`**: bypasses that window, so a user-initiated refresh actually reaches pi.dev (one request
 *   per credentialed provider; conditional — hence usually a 304 — wherever a cached body backs the
 *   stored `ETag`).
 *
 * **Single-flighted per runtime**, tracked with the kind: a forced caller never joins a throttled pass
 * (it would silently inherit the no-op), it queues behind it and then fetches for real.
 *
 * Resolves with **`completed`**: whether the pass this caller waited on actually finished (see
 * `withDeadline`). A `false` means the snapshot the caller goes on to read is *not* the host's settled
 * verdict, which is what keeps the client from marking such a list authoritative.
 *
 * Never throws and never hangs: failures are logged and swallowed, and what a caller awaits carries its
 * own `CATALOG_REFRESH_TIMEOUT_MS` ceiling (`withDeadline`) — either way the caller gets a resolution and
 * then serves whatever the registry holds. `PI_OFFLINE` (pi's env convention, also set by the e2e
 * harness for hermeticity) disables it entirely (resolves immediately).
 */
export function refreshCatalogs(
	runtime: CatalogRefreshRuntime,
	{ force = false }: { force?: boolean } = {},
): Promise<CatalogRefreshOutcome> {
	// Nothing to fetch, so the registry as it stands *is* the settled answer — a completed pass.
	if (process.env.PI_OFFLINE) return Promise.resolve({ completed: true });
	const existing = inflightCatalogRefresh.get(runtime);
	if (existing && (existing.force || !force)) return withDeadline(existing.task);
	// Free slot ⇒ start now (an implicit trigger must reach pi in the same tick it fires). Otherwise
	// this is a forced caller behind a throttled pass: queue, so pi's own per-provider in-flight dedupe
	// has cleared by the time the forced fetch runs.
	const started = existing
		? existing.task.then(() => runCatalogRefresh(runtime, force))
		: runCatalogRefresh(runtime, force);
	const task: Promise<void> = started.finally(() => {
		if (inflightCatalogRefresh.get(runtime)?.task === task) {
			inflightCatalogRefresh.delete(runtime);
		}
	});
	inflightCatalogRefresh.set(runtime, { task, force });
	return withDeadline(task);
}

/**
 * The ceiling every *caller* gets, started at call time. `runCatalogRefresh`'s abort signal covers only
 * `models.refresh` — pi awaits `forceRefreshAvailability()` after it with no signal, and that's the
 * per-provider auth-check fan-out where a stalled local provider lives — and a queued forced pass adds a
 * second pass on top of the wait, so an awaited `model.refresh` is otherwise unbounded and the picker's
 * refresh row spins with no cap. Single-flight still tracks the *unbounded* task, so a timed-out caller
 * can't start a second concurrent refresh; it just serves the registry as it stands.
 *
 * `completed: false` is how the caller learns its answer is that unsettled registry — the pass it waited
 * on is still running — so nothing downstream mistakes it for the host's verdict.
 */
function withDeadline(task: Promise<void>): Promise<CatalogRefreshOutcome> {
	return new Promise<CatalogRefreshOutcome>((resolve) => {
		const timer = setTimeout(() => {
			console.warn(
				`model catalog refresh exceeded ${CATALOG_REFRESH_TIMEOUT_MS}ms; serving cached catalogs`,
			);
			resolve({ completed: false });
		}, CATALOG_REFRESH_TIMEOUT_MS);
		// The pending timer must keep neither a shutting-down host nor a test process alive.
		timer.unref?.();
		void task.then(() => {
			clearTimeout(timer);
			resolve({ completed: true });
		});
	});
}

/** One refresh pass against pi, with the abort budget applied. Resolves even on failure. */
function runCatalogRefresh(runtime: CatalogRefreshRuntime, force: boolean): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CATALOG_REFRESH_TIMEOUT_MS);
	// The pending abort timer must keep neither a shutting-down host nor a test process alive.
	timer.unref?.();
	return runtime
		.refresh({ allowNetwork: true, force, signal: controller.signal })
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
		.finally(() => clearTimeout(timer));
}

/** Fire-and-forget wrapper over `refreshCatalogs` — the `model.list` trigger (issue #98): the caller
 * returns the current snapshot immediately; a later read picks up whatever the refresh landed. */
export function refreshCatalogsDetached(runtime: CatalogRefreshRuntime): void {
	void refreshCatalogs(runtime);
}
