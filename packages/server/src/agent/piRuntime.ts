import { resolve } from "node:path";
import {
	createAgentSessionServices,
	DefaultResourceLoader,
	getAgentDir,
	type LoadExtensionsResult,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { logger } from "../log";
import { accountAvailableModels, type ModelAvailabilityRuntime } from "./modelAvailability";
import { advancePiExtensionCache, createPiSettings } from "./packages";

const log = logger("agent");

export interface PiRuntimeGeneration {
	readonly id: number;
	readonly runtime: ModelRuntime;
	readonly providerStatusIds: ReadonlySet<string>;
	readonly providerStatusNames: ReadonlyMap<string, string>;
	readonly opaqueProviderIds: ReadonlySet<string>;
	readonly extensionProviderIds: ReadonlySet<string>;
	readonly additionalExtensionPaths: readonly string[];
	readonly excludedSessionExtensionPaths: readonly string[];
}

export type PreparePiRuntimeGenerationResult =
	| { outcome: "prepared"; generation: PiRuntimeGeneration }
	| { outcome: "failed"; reason: "candidate-failed" };

export type PiRuntimeGenerationInitializer = (runtime: ModelRuntime) => void | Promise<void>;

export const piLoginOptions: NonNullable<Parameters<ModelRuntime["login"]>[3]> = {
	getDeviceId: () =>
		createPiSettings(process.cwd(), undefined, { packages: "none" }).getOrCreateDeviceId(),
};

let nextGenerationId = 1;
let activeGeneration: Promise<PiRuntimeGeneration> | null = null;
let configuredExtensionPaths: readonly string[] = [];
let configuredSessionExtensionExclusions: readonly string[] = [];
interface PreparedRuntime {
	runtime: ModelRuntime;
	providerStatusIds: ReadonlySet<string>;
	providerStatusNames: ReadonlyMap<string, string>;
	opaqueProviderIds: ReadonlySet<string>;
	extensionProviderIds: ReadonlySet<string>;
}
let runtimeFactory: (additionalExtensionPaths: readonly string[]) => Promise<PreparedRuntime> =
	createRuntimeWithExtensions;
let generationInitializer: PiRuntimeGenerationInitializer = () => {};

function captureProviderStatus(runtime: ModelRuntime): {
	ids: ReadonlySet<string>;
	names: ReadonlyMap<string, string>;
} {
	const providers = runtime.getProviders?.() ?? [];
	return {
		ids: new Set(providers.map((provider) => provider.id)),
		names: new Map(providers.map((provider) => [provider.id, provider.name])),
	};
}

export function configurePiRuntime(rt: ModelRuntime | null): void {
	configuredExtensionPaths = [];
	configuredSessionExtensionExclusions = [];
	if (!rt) {
		activeGeneration = null;
		return;
	}
	const providerStatus = captureProviderStatus(rt);
	activeGeneration = Promise.resolve({
		id: nextGenerationId++,
		runtime: rt,
		providerStatusIds: providerStatus.ids,
		providerStatusNames: providerStatus.names,
		opaqueProviderIds: new Set<string>(),
		extensionProviderIds: new Set<string>(),
		additionalExtensionPaths: [],
		excludedSessionExtensionPaths: [],
	});
}

export function configurePiRuntimeFactory(
	factory?: (additionalExtensionPaths: readonly string[]) => Promise<ModelRuntime>,
): void {
	runtimeFactory = factory
		? async (additionalExtensionPaths) => {
				const runtime = await factory(additionalExtensionPaths);
				await generationInitializer(runtime);
				const providerStatus = captureProviderStatus(runtime);
				return {
					runtime,
					providerStatusIds: providerStatus.ids,
					providerStatusNames: providerStatus.names,
					opaqueProviderIds: new Set<string>(),
					extensionProviderIds: new Set<string>(),
				};
			}
		: createRuntimeWithExtensions;
}

export function configurePiRuntimeGenerationInitializer(
	initializer?: PiRuntimeGenerationInitializer,
): void {
	if (activeGeneration) throw new Error("PI runtime already initialized");
	generationInitializer = initializer ?? (() => {});
}

export function configurePiRuntimeSessionExtensionExclusions(paths: readonly string[]): void {
	if (activeGeneration) throw new Error("PI runtime already initialized");
	configuredSessionExtensionExclusions = [...new Set(paths)];
}

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

async function createRuntimeWithExtensions(
	additionalExtensionPaths: readonly string[],
): Promise<PreparedRuntime> {
	await advancePiExtensionCache(getAgentDir());
	const runtime = await createRuntimeOfflineByDefault();
	await generationInitializer(runtime);
	const providerStatus = captureProviderStatus(runtime);
	const priorRegistrations = new Map(
		runtime.getRegisteredProviderIds().map((id) => [
			id,
			{
				provider: runtime.getRegisteredNativeProvider(id),
				registration: runtime.getRegisteredProviderConfig(id),
			},
		]),
	);
	const priorJitiRebuild = process.env.JITI_REBUILD_FS_CACHE;
	const priorJitiTryNative = process.env.JITI_TRY_NATIVE;
	process.env.JITI_REBUILD_FS_CACHE = "1";
	process.env.JITI_TRY_NATIVE = "false";
	let services: Awaited<ReturnType<typeof createAgentSessionServices>>;
	let extensionProviderIds: ReadonlySet<string> = new Set();
	let opaqueProviderIds: ReadonlySet<string> = new Set();
	try {
		services = await createAgentSessionServices({
			cwd: getAgentDir(),
			settingsManager: createPiSettings(getAgentDir(), getAgentDir(), { packages: "none" }),
			modelRuntime: runtime,
			resourceLoaderOptions: {
				noExtensions: true,
				additionalExtensionPaths: [...additionalExtensionPaths],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			},
		});
		// Freeze everything the additional paths contributed — new ids and re-registrations —
		// before user extensions register, so the two sources stay attributable: what the
		// user-extension pass registers below never reads back as Central.
		const postExtensionProviderStatus = captureProviderStatus(runtime);
		opaqueProviderIds = new Set(
			additionalExtensionPaths.length > 0
				? [
						...[...postExtensionProviderStatus.ids].filter((id) => !providerStatus.ids.has(id)),
						...runtime.getRegisteredProviderIds().filter((id) => {
							const prior = priorRegistrations.get(id);
							return (
								!prior ||
								prior.provider !== runtime.getRegisteredNativeProvider(id) ||
								prior.registration !== runtime.getRegisteredProviderConfig(id)
							);
						}),
					]
				: [],
		);
		extensionProviderIds = await loadUserExtensionProviders(runtime, additionalExtensionPaths);
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
	return {
		runtime,
		providerStatusIds: providerStatus.ids,
		providerStatusNames: providerStatus.names,
		opaqueProviderIds,
		extensionProviderIds,
	};
}

/**
 * Drops extensions resolved at excluded paths from a load result, together with the
 * registrations they queued: the paths belong to the primary catalog load above and must
 * not register twice through the user-extension pass.
 */
function omitExcludedExtensions(
	result: LoadExtensionsResult,
	excluded: ReadonlySet<string>,
): LoadExtensionsResult {
	const resolvedOf = new Map(
		result.extensions.map((extension) => [extension.path, extension.resolvedPath]),
	);
	const kept = (extensionPath: string): boolean => {
		const resolved = resolvedOf.get(extensionPath);
		return resolved !== undefined && !excluded.has(resolved);
	};
	return {
		...result,
		extensions: result.extensions.filter((extension) => !excluded.has(extension.resolvedPath)),
		runtime: {
			...result.runtime,
			pendingProviderRegistrations: result.runtime.pendingProviderRegistrations.filter(
				(registration) => kept(registration.extensionPath),
			),
			pendingNativeProviderRegistrations: result.runtime.pendingNativeProviderRegistrations.filter(
				(registration) => kept(registration.extensionPath),
			),
			pendingVirtualModelRegistrations: result.runtime.pendingVirtualModelRegistrations.filter(
				(registration) => kept(registration.extensionPath),
			),
		},
	};
}

/**
 * Loads the enabled user extensions with the same package view a chat session resolves and
 * applies their queued provider registrations to the shared runtime, so extension models
 * are in the catalog from startup instead of appearing as a side effect of the first chat
 * (#1351). pi's own CLI does this inside createAgentSessionServices, which the catalog
 * load above skips. A broken user extension costs only its own registrations — it never
 * fails the generation, matching how a failed extension degrades inside a session.
 */
async function loadUserExtensionProviders(
	runtime: ModelRuntime,
	additionalExtensionPaths: readonly string[],
): Promise<ReadonlySet<string>> {
	const agentDir = getAgentDir();
	const excluded = new Set(additionalExtensionPaths.map((path) => resolve(path)));
	const loader = new DefaultResourceLoader({
		cwd: agentDir,
		agentDir,
		settingsManager: createPiSettings(agentDir, agentDir, { packages: "enabled" }),
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionsOverride: (result) => omitExcludedExtensions(result, excluded),
	});
	let loaded: LoadExtensionsResult;
	try {
		await loader.reload();
		loaded = loader.getExtensions();
	} catch (error) {
		log.warn("user extension loading failed for the shared catalog", error);
		return new Set();
	}
	for (const { path, error } of loaded.errors) {
		log.warn(`user extension ${path} failed to load: ${error}`);
	}
	const registered = new Set<string>();
	const apply = (extensionPath: string, id: string, register: () => void): void => {
		try {
			register();
			registered.add(id);
		} catch (error) {
			log.warn(`user extension ${extensionPath}: provider ${id} registration failed`, error);
		}
	};
	for (const { name, config, extensionPath } of loaded.runtime.pendingProviderRegistrations) {
		apply(extensionPath, name, () => runtime.registerProvider(name, config));
	}
	for (const { provider, extensionPath } of loaded.runtime.pendingNativeProviderRegistrations) {
		apply(extensionPath, provider.id, () => runtime.registerNativeProvider(provider));
	}
	for (const { definition, extensionPath } of loaded.runtime.pendingVirtualModelRegistrations) {
		try {
			runtime.registerVirtualModel(definition);
		} catch (error) {
			log.warn(
				`user extension ${extensionPath}: virtual model ${definition.provider}/${definition.id} registration failed`,
				error,
			);
		}
	}
	return registered;
}

async function createGeneration(paths: readonly string[]): Promise<PiRuntimeGeneration> {
	const additionalExtensionPaths = [...new Set(paths)];
	const excludedSessionExtensionPaths = [...configuredSessionExtensionExclusions];
	const prepared = await runtimeFactory(additionalExtensionPaths);
	return {
		id: nextGenerationId++,
		runtime: prepared.runtime,
		providerStatusIds: prepared.providerStatusIds,
		providerStatusNames: prepared.providerStatusNames,
		opaqueProviderIds: prepared.opaqueProviderIds,
		extensionProviderIds: prepared.extensionProviderIds,
		additionalExtensionPaths,
		excludedSessionExtensionPaths,
	};
}

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

/** Settle in-flight credential writes on the active generation and `others`; never creates a generation. */
export async function settlePiCredentialWrites(others: Iterable<ModelRuntime> = []): Promise<void> {
	const runtimes = new Set(others);
	if (activeGeneration) {
		try {
			runtimes.add((await activeGeneration).runtime);
		} catch {}
	}
	await Promise.allSettled([...runtimes].map((runtime) => runtime.settleCredentialWrites()));
}

export async function preparePiRuntimeGeneration(
	additionalExtensionPaths: readonly string[],
): Promise<PreparePiRuntimeGenerationResult> {
	try {
		return { outcome: "prepared", generation: await createGeneration(additionalExtensionPaths) };
	} catch {
		return { outcome: "failed", reason: "candidate-failed" };
	}
}

export function activatePiRuntimeGeneration(generation: PiRuntimeGeneration): void {
	configuredExtensionPaths = generation.additionalExtensionPaths;
	configuredSessionExtensionExclusions = generation.excludedSessionExtensionPaths;
	activeGeneration = Promise.resolve(generation);
}

export type AvailableModelsRuntime = ModelAvailabilityRuntime;

export function settledAvailableModels(
	runtime: AvailableModelsRuntime,
): ReturnType<ModelRuntime["getAvailableSnapshot"]> {
	return accountAvailableModels(runtime);
}

export type CatalogRefreshRuntime = Pick<ModelRuntime, "refresh">;

export interface CatalogRefreshOutcome {
	completed: boolean;
}

const inflightCatalogRefresh = new WeakMap<
	CatalogRefreshRuntime,
	{ task: Promise<void>; force: boolean }
>();

const CATALOG_REFRESH_TIMEOUT_MS = 15_000;

export function refreshCatalogs(
	runtime: CatalogRefreshRuntime,
	{ force = false }: { force?: boolean } = {},
): Promise<CatalogRefreshOutcome> {
	if (process.env.PI_OFFLINE) return Promise.resolve({ completed: true });
	const existing = inflightCatalogRefresh.get(runtime);
	if (existing && (existing.force || !force)) return withDeadline(existing.task);
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

function withDeadline(task: Promise<void>): Promise<CatalogRefreshOutcome> {
	return new Promise<CatalogRefreshOutcome>((resolve) => {
		const timer = setTimeout(() => {
			log.warn(
				`model catalog refresh exceeded ${CATALOG_REFRESH_TIMEOUT_MS}ms; serving cached catalogs`,
			);
			resolve({ completed: false });
		}, CATALOG_REFRESH_TIMEOUT_MS);
		timer.unref?.();
		void task.then(() => {
			clearTimeout(timer);
			resolve({ completed: true });
		});
	});
}

function runCatalogRefresh(runtime: CatalogRefreshRuntime, force: boolean): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CATALOG_REFRESH_TIMEOUT_MS);
	timer.unref?.();
	return runtime
		.refresh({ allowNetwork: true, force, signal: controller.signal })
		.then((result) => {
			if (result.aborted) {
				log.warn(
					`model catalog refresh timed out after ${CATALOG_REFRESH_TIMEOUT_MS}ms; serving cached catalogs`,
				);
			} else if (result.errors.size > 0) {
				log.warn(`model catalog refresh: ${result.errors.size} provider(s) failed`);
			}
		})
		.catch(() => {
			log.warn("model catalog refresh failed");
		})
		.finally(() => clearTimeout(timer));
}

export function refreshCatalogsDetached(runtime: CatalogRefreshRuntime): void {
	void refreshCatalogs(runtime);
}
