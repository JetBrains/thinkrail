import {
	createAgentSessionServices,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";

/** One coherent model/resource generation shared by every pre-session read and live session. */
export interface PiRuntimeGeneration {
	readonly id: number;
	readonly runtime: ModelRuntime;
	/** Provider ids present before opaque extensions load; the auth UI may inspect only this allowlist. */
	readonly providerStatusIds: ReadonlySet<string>;
	/** Opaque extensions applied once to this generation's shared provider runtime. */
	readonly additionalExtensionPaths: readonly string[];
	/** Opaque paths that session loaders must not execute again (including inactive Central artifacts). */
	readonly excludedSessionExtensionPaths: readonly string[];
}

export type PreparePiRuntimeGenerationResult =
	| { outcome: "prepared"; generation: PiRuntimeGeneration }
	| { outcome: "failed"; reason: "candidate-failed" };

export type PiRuntimeGenerationInitializer = (runtime: ModelRuntime) => void | Promise<void>;

let nextGenerationId = 1;
let activeGeneration: Promise<PiRuntimeGeneration> | null = null;
let configuredExtensionPaths: readonly string[] = [];
let configuredSessionExtensionExclusions: readonly string[] = [];
interface PreparedRuntime {
	runtime: ModelRuntime;
	providerStatusIds: ReadonlySet<string>;
}
let runtimeFactory: (additionalExtensionPaths: readonly string[]) => Promise<PreparedRuntime> =
	createRuntimeWithExtensions;
let generationInitializer: PiRuntimeGenerationInitializer = () => {};

function captureProviderStatusIds(runtime: ModelRuntime): ReadonlySet<string> {
	// Optional-chained: narrow unit fakes omit `getProviders`; empty = the fail-closed allowlist.
	return new Set(runtime.getProviders?.().map((provider) => provider.id) ?? []);
}

/** Override the shared runtime — tests inject a faux-backed one so no auth/network is needed. */
export function configurePiRuntime(rt: ModelRuntime | null): void {
	configuredExtensionPaths = [];
	configuredSessionExtensionExclusions = [];
	activeGeneration = rt
		? Promise.resolve({
				id: nextGenerationId++,
				runtime: rt,
				providerStatusIds: captureProviderStatusIds(rt),
				additionalExtensionPaths: [],
				excludedSessionExtensionPaths: [],
			})
		: null;
}

/** Test seam for candidate generations; production always restores the public PI factory. */
export function configurePiRuntimeFactory(
	factory?: (additionalExtensionPaths: readonly string[]) => Promise<ModelRuntime>,
): void {
	runtimeFactory = factory
		? async (additionalExtensionPaths) => {
				const runtime = await factory(additionalExtensionPaths);
				await generationInitializer(runtime);
				return {
					runtime,
					providerStatusIds: captureProviderStatusIds(runtime),
				};
			}
		: createRuntimeWithExtensions;
}

/** Composition seam: registrations every fresh generation must repeat — install before bootstrap. */
export function configurePiRuntimeGenerationInitializer(
	initializer?: PiRuntimeGenerationInitializer,
): void {
	if (activeGeneration) throw new Error("PI runtime already initialized");
	generationInitializer = initializer ?? (() => {});
}

/** Opaque paths that session loaders must never execute, whatever the active generation holds. */
export function configurePiRuntimeSessionExtensionExclusions(paths: readonly string[]): void {
	if (activeGeneration) throw new Error("PI runtime already initialized");
	configuredSessionExtensionExclusions = [...new Set(paths)];
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

/** PI's extension-factory cache is path-keyed and Central replaces its file in place; this empty
 * loader's second `reload()` is PI's public cache-invalidating transition (it reads no artifact). */
async function advanceExtensionCacheGeneration(): Promise<void> {
	const agentDir = getAgentDir();
	const loader = new DefaultResourceLoader({
		cwd: agentDir,
		agentDir,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	await loader.reload();
}

async function createRuntimeWithExtensions(
	additionalExtensionPaths: readonly string[],
): Promise<PreparedRuntime> {
	await advanceExtensionCacheGeneration();
	const runtime = await createRuntimeOfflineByDefault();
	await generationInitializer(runtime);
	// Captured BEFORE the opaque extensions run — the pre-opaque allowlist for `provider.status`.
	const providerStatusIds = captureProviderStatusIds(runtime);
	// Jiti's on-disk transpile cache is also path-keyed; force its documented rebuild mode for this load only.
	const priorJitiRebuild = process.env.JITI_REBUILD_FS_CACHE;
	const priorJitiTryNative = process.env.JITI_TRY_NATIVE;
	process.env.JITI_REBUILD_FS_CACHE = "1";
	// Bun's native ESM importer caches by path for the process lifetime; the binary loader already skips it.
	process.env.JITI_TRY_NATIVE = "false";
	let services: Awaited<ReturnType<typeof createAgentSessionServices>>;
	try {
		services = await createAgentSessionServices({
			cwd: getAgentDir(),
			modelRuntime: runtime,
			resourceLoaderOptions: {
				// No auto-discovery: an unopted-in Central artifact in the default agent dir must not slip in.
				noExtensions: true,
				additionalExtensionPaths: [...additionalExtensionPaths],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			},
		});
	} finally {
		if (priorJitiRebuild === undefined) delete process.env.JITI_REBUILD_FS_CACHE;
		else process.env.JITI_REBUILD_FS_CACHE = priorJitiRebuild;
		if (priorJitiTryNative === undefined) delete process.env.JITI_TRY_NATIVE;
		else process.env.JITI_TRY_NATIVE = priorJitiTryNative;
	}
	const extensionErrors = services.resourceLoader.getExtensions().errors;
	if (
		extensionErrors.length > 0 ||
		services.diagnostics.some((diagnostic) => diagnostic.type === "error")
	) {
		throw new Error("PI runtime extension loading failed");
	}
	return { runtime, providerStatusIds };
}

async function createGeneration(paths: readonly string[]): Promise<PiRuntimeGeneration> {
	const additionalExtensionPaths = [...new Set(paths)];
	const excludedSessionExtensionPaths = [...configuredSessionExtensionExclusions];
	const prepared = await runtimeFactory(additionalExtensionPaths);
	return {
		id: nextGenerationId++,
		runtime: prepared.runtime,
		providerStatusIds: prepared.providerStatusIds,
		additionalExtensionPaths,
		excludedSessionExtensionPaths,
	};
}

/** The active generation, built lazily so test/e2e environment overrides are honored. */
export function getPiRuntimeGeneration(): Promise<PiRuntimeGeneration> {
	if (!activeGeneration) {
		const created = createGeneration(configuredExtensionPaths);
		activeGeneration = created;
		created.catch(() => {
			if (activeGeneration === created) activeGeneration = null;
		});
	}
	return activeGeneration;
}

export async function getPiRuntime(): Promise<ModelRuntime> {
	return (await getPiRuntimeGeneration()).runtime;
}

/** Build, but do not activate, a candidate generation. Raw PI/extension failures are discarded. */
export async function preparePiRuntimeGeneration(
	additionalExtensionPaths: readonly string[],
): Promise<PreparePiRuntimeGenerationResult> {
	try {
		return { outcome: "prepared", generation: await createGeneration(additionalExtensionPaths) };
	} catch {
		return { outcome: "failed", reason: "candidate-failed" };
	}
}

/** Atomically publish a prepared generation for pre-session reads and future sessions. */
export function activatePiRuntimeGeneration(generation: PiRuntimeGeneration): void {
	configuredExtensionPaths = generation.additionalExtensionPaths;
	configuredSessionExtensionExclusions = generation.excludedSessionExtensionPaths;
	activeGeneration = Promise.resolve(generation);
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
				// Provider ids and errors may belong to an opaque extension; log only a closed count.
				console.warn(`model catalog refresh: ${result.errors.size} provider(s) failed`);
			}
		})
		.catch(() => {
			console.warn("model catalog refresh failed");
		})
		.finally(() => clearTimeout(timer));
}

/** Fire-and-forget wrapper over `refreshCatalogs` — the `model.list` trigger (issue #98): the caller
 * returns the current snapshot immediately; a later read picks up whatever the refresh landed. */
export function refreshCatalogsDetached(runtime: CatalogRefreshRuntime): void {
	void refreshCatalogs(runtime);
}
