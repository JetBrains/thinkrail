import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	blockedExtensionKey,
	type ExtensionInfo,
	type ExtensionSurface,
	type ExtRemovedPush,
	extChannelKey,
	isOwnChannelKey,
	type SessionEventPayload,
} from "@thinkrail/contracts";
import type { ActionCtx, ExtStore, PiExtensionFactory } from "@thinkrail/ext";
import { type AgentBackend, NO_AGENTS } from "./agents";
import { buildAssets, type ExtAssets } from "./build";
import {
	type Candidate,
	discoverExtensions,
	type ProjectCandidate,
	type ProjectRoot,
	projectExtensionsDir,
} from "./discovery";
import { createGeneration, type Generation } from "./generation";
import { importExtension } from "./loader";
import { type ManifestTheme, readManifest } from "./manifest";
import { createDryStore, createExtStore } from "./store";
import { createTr, formatLog, NO_WORKSPACES, type SessionReads, type WorkspaceReads } from "./tr";
import { errorMessage } from "./util";
import { createExtWatcher } from "./watch";

const LOG_LIMIT = 500;

export interface ExtLogEntry {
	at: number;
	level: "info" | "error";
	message: string;
}

export interface ExtHostOptions {
	userDir: string;
	storeDir: string;
	sessions: SessionReads;
	workspaces?: WorkspaceReads;
	agents?: AgentBackend;
	onPiFactoriesChanged?: () => void;
	onChanged?: (info: ExtensionInfo) => void;
	onRemoved?: (removed: ExtRemovedPush) => void;
	onChannel?: (key: string, value: unknown) => void;
	onChannelsDropped?: (name: string, keys: string[]) => void;
	warn?: (message: string) => void;
	watchDebounceMs?: number;
}

export type ExtValidation =
	| { ok: true; surfaces: ExtensionSurface[]; build: string; logs: string[] }
	| { ok: false; errors: string[]; logs: string[] };

interface Sink {
	store: ExtStore;
	log: (level: ExtLogEntry["level"], message: string) => void;
}

interface ExtState {
	candidate: Candidate;
	title: string;
	surfaces: ExtensionSurface[];
	permissions: string[];
	themes: ManifestTheme[];
	current: Generation | undefined;
	assets: ExtAssets | undefined;
	error: string | undefined;
	queue: Promise<unknown>;
}

const infoOf = (state: ExtState): ExtensionInfo => ({
	name: state.candidate.name,
	title: state.title,
	scope: state.candidate.scope,
	...(state.candidate.projectId !== undefined ? { projectId: state.candidate.projectId } : {}),
	status: state.error === undefined ? "active" : "error",
	generation: state.current?.id ?? null,
	surfaces: state.surfaces,
	permissions: state.permissions,
	themes: state.themes.map(({ cssFile: _cssFile, ...theme }) => theme),
	build: state.assets?.build ?? null,
	...(state.error !== undefined ? { error: state.error } : {}),
});

const blockedInfo = async (candidate: ProjectCandidate) => {
	const read = await readManifest(candidate.dir);
	const manifest = read.ok ? read.manifest : undefined;
	return {
		name: candidate.name,
		title: manifest?.title ?? candidate.name,
		scope: candidate.scope,
		projectId: candidate.projectId,
		status: "blocked" as const,
		generation: null,
		surfaces: manifest?.surfaces ?? [],
		permissions: manifest?.permissions ?? [],
		themes: [],
		build: null,
	};
};

const sameCandidate = (a: Candidate, b: Candidate) =>
	a.dir === b.dir && a.scope === b.scope && a.projectId === b.projectId;

export const createExtHost = (options: ExtHostOptions) => {
	const states = new Map<string, ExtState>();
	const stores = new Map<string, ExtStore>();
	const logs = new Map<string, ExtLogEntry[]>();
	const channels = new Map<string, unknown>();
	const blocked = new Map<string, Awaited<ReturnType<typeof blockedInfo>>>();
	let projectRoots: readonly ProjectRoot[] = [];
	let blockedRoots: readonly ProjectRoot[] = [];
	let nextGeneration = 1;
	let disposed = false;

	const log = (name: string, level: ExtLogEntry["level"], message: string) => {
		const entries = logs.get(name) ?? [];
		entries.push({ at: Date.now(), level, message });
		if (entries.length > LOG_LIMIT) entries.splice(0, entries.length - LOG_LIMIT);
		logs.set(name, entries);
		if (level === "error") options.warn?.(`extension ${name}: ${message}`);
	};

	const storeFor = (name: string) => {
		const existing = stores.get(name);
		if (existing) return existing;
		const created = createExtStore({ dir: options.storeDir, name });
		stores.set(name, created);
		return created;
	};

	const emitChannel = (key: string, value: unknown) => {
		channels.set(key, value);
		options.onChannel?.(key, value);
	};

	const dropChannel = (name: string, key: string) => {
		if (!channels.delete(key) || disposed) return;
		options.onChannelsDropped?.(name, [key]);
	};

	const viewers = new Map<string, ReadonlySet<string>>();
	const watchCounts = new Map<string, number>();

	const watchedOf = (name: string) =>
		[...watchCounts.keys()]
			.filter((key) => isOwnChannelKey(name, key))
			.map((key) => key.slice(extChannelKey(name, "").length));

	const notifyWatch = (key: string, watching: boolean) => {
		const split = key.indexOf(":");
		if (split <= 0) return;
		const name = key.slice(0, split);
		states.get(name)?.current?.notifyWatch(key.slice(split + 1), watching);
	};

	const setWatched = (clientKey: string, keys: readonly string[]) => {
		const next = new Set(keys);
		const previous = viewers.get(clientKey) ?? new Set<string>();
		if (next.size > 0) viewers.set(clientKey, next);
		else viewers.delete(clientKey);
		for (const key of previous) {
			if (next.has(key)) continue;
			const count = (watchCounts.get(key) ?? 1) - 1;
			if (count > 0) watchCounts.set(key, count);
			else {
				watchCounts.delete(key);
				notifyWatch(key, false);
			}
		}
		for (const key of next) {
			if (previous.has(key)) continue;
			const count = (watchCounts.get(key) ?? 0) + 1;
			watchCounts.set(key, count);
			if (count === 1) notifyWatch(key, true);
		}
	};

	const dropChannels = (name: string) => {
		const keys = [...channels.keys()].filter((key) => isOwnChannelKey(name, key));
		for (const key of keys) channels.delete(key);
		if (keys.length > 0 && !disposed) options.onChannelsDropped?.(name, keys);
	};

	const disposeGeneration = async (generation: Generation, sink: Sink["log"]) => {
		const failures = await generation.dispose();
		for (const failure of failures) sink("error", `dispose: ${formatLog([failure])}`);
	};

	const liveSink = (name: string): Sink => ({
		store: storeFor(name),
		log: (level, message) => log(name, level, message),
	});

	const serialized = <T>(state: ExtState, task: () => Promise<T>) => {
		const run = state.queue.then(task);
		state.queue = run.catch(() => {});
		return run;
	};

	const prepare = async (candidate: Candidate, generationId: () => number, sink: Sink) => {
		const { name, dir } = candidate;
		const manifest = await readManifest(dir);
		if (!manifest.ok) return { ok: false as const, errors: manifest.errors };
		let assets: ExtAssets;
		try {
			assets = await buildAssets({
				dir,
				surfaces: manifest.manifest.surfaces,
				themes: manifest.manifest.themes,
			});
		} catch (error) {
			return { ok: false as const, errors: [errorMessage(error)] };
		}
		let factory: Awaited<ReturnType<typeof importExtension>>;
		try {
			factory = await importExtension(dir);
		} catch (error) {
			return { ok: false as const, errors: [`index.ts: ${errorMessage(error)}`] };
		}
		const generation = createGeneration({
			id: generationId(),
			emit: emitChannel,
			drop: (key) => dropChannel(name, key),
			watched: () => watchedOf(name),
		});
		const tr = createTr({
			name,
			dir,
			generation,
			store: sink.store,
			sessions: options.sessions,
			workspaces: options.workspaces ?? NO_WORKSPACES,
			agents: options.agents ?? NO_AGENTS,
			watched: () => watchedOf(name),
			log: sink.log,
		});
		try {
			const cleanup = await factory(tr);
			if (typeof cleanup === "function") generation.addDisposer(cleanup);
		} catch (error) {
			await disposeGeneration(generation, sink.log);
			return { ok: false as const, errors: [`factory threw: ${errorMessage(error)}`] };
		}
		return { ok: true as const, manifest: manifest.manifest, assets, generation };
	};

	const loadInto = async (state: ExtState) => {
		const { name } = state.candidate;
		const sink = liveSink(name);
		const prepared = await prepare(state.candidate, () => nextGeneration++, sink);
		if (!prepared.ok) {
			state.error = prepared.errors.join("\n");
			log(name, "error", `load failed: ${state.error}`);
			options.onChanged?.(infoOf(state));
			return infoOf(state);
		}
		const { manifest, assets, generation } = prepared;
		if (disposed || states.get(name) !== state) {
			await disposeGeneration(generation, sink.log);
			return infoOf(state);
		}
		const previous = state.current;
		const piChanged = (previous?.piFactories.size ?? 0) > 0 || generation.piFactories.size > 0;
		state.current = generation;
		state.assets = assets;
		state.error = undefined;
		state.title = manifest.title;
		state.surfaces = manifest.surfaces;
		state.permissions = manifest.permissions;
		state.themes = manifest.themes;
		dropChannels(name);
		generation.activate();
		if (previous) await disposeGeneration(previous, sink.log);
		log(name, "info", `generation ${generation.id} active`);
		if (piChanged) options.onPiFactoriesChanged?.();
		options.onChanged?.(infoOf(state));
		return infoOf(state);
	};

	const stateFor = (candidate: Candidate): ExtState => ({
		candidate,
		title: candidate.name,
		surfaces: [],
		permissions: [],
		themes: [],
		current: undefined,
		assets: undefined,
		error: undefined,
		queue: Promise.resolve(),
	});

	const unload = (name: string) => {
		const state = states.get(name);
		if (!state) return Promise.resolve();
		states.delete(name);
		return serialized(state, async () => {
			const generation = state.current;
			state.current = undefined;
			state.assets = undefined;
			const hadPiFactories = (generation?.piFactories.size ?? 0) > 0;
			if (generation)
				await disposeGeneration(generation, (level, message) => log(name, level, message));
			dropChannels(name);
			if (disposed) return;
			options.onRemoved?.({ name });
			if (hadPiFactories) options.onPiFactoriesChanged?.();
		});
	};

	const syncBlocked = async (found: readonly ProjectCandidate[]) => {
		const infos = await Promise.all(found.map(blockedInfo));
		if (disposed) return;
		const next = new Map(
			infos.map((info) => [blockedExtensionKey(info.projectId, info.name), info]),
		);
		for (const [key, info] of [...blocked]) {
			if (next.has(key)) continue;
			blocked.delete(key);
			options.onRemoved?.({ name: info.name, blockedProjectId: info.projectId });
		}
		for (const [key, info] of next) {
			const previous = blocked.get(key);
			blocked.set(key, info);
			if (!previous || JSON.stringify(previous) !== JSON.stringify(info)) options.onChanged?.(info);
		}
	};

	const scan = async () => {
		const {
			candidates,
			duplicates,
			blocked: blockedFound,
		} = await discoverExtensions({
			userDir: options.userDir,
			projectRoots,
			blockedRoots,
		});
		for (const duplicate of duplicates)
			options.warn?.(
				`extension ${duplicate.name} at ${duplicate.dir} skipped: name already loaded`,
			);
		const wanted = new Map(candidates.map((candidate) => [candidate.name, candidate]));
		const tasks: Promise<unknown>[] = [];
		for (const [name, state] of states) {
			const candidate = wanted.get(name);
			if (!candidate || !sameCandidate(candidate, state.candidate)) tasks.push(unload(name));
		}
		await Promise.all(tasks);
		await syncBlocked(blockedFound);
		const loads: Promise<unknown>[] = [];
		for (const candidate of candidates) {
			if (states.has(candidate.name)) continue;
			const state = stateFor(candidate);
			states.set(candidate.name, state);
			loads.push(serialized(state, () => loadInto(state)));
		}
		await Promise.all(loads);
	};

	const roots = () => ({
		user: options.userDir,
		projects: projectRoots.map((root) => projectExtensionsDir(root.path)),
	});

	const watcher =
		options.watchDebounceMs === undefined
			? undefined
			: createExtWatcher({
					debounceMs: options.watchDebounceMs,
					onChange: ({ root, name }) => {
						const loaded = states.get(name)?.candidate.dir === join(root, name);
						void (loaded ? reload(name) : rescan()).catch(() => {});
					},
					...(options.warn ? { warn: options.warn } : {}),
				});
	if (watcher) mkdirSync(options.userDir, { recursive: true });

	let scans: Promise<unknown> = Promise.resolve();
	const rescan = () => {
		const run = scans.then(scan).finally(() => {
			const { user, projects } = roots();
			watcher?.sync([
				user,
				...projects,
				...blockedRoots.map((root) => projectExtensionsDir(root.path)),
			]);
		});
		scans = run.catch(() => {});
		return run;
	};

	const notFound = (name: string) => {
		const { user, projects } = roots();
		const places = [user, ...projects].map((root) => join(root, name)).join(", ");
		return `extension "${name}" not found; looked for ${places}/extension.json (project dirs load only for trusted projects)`;
	};

	const reload = async (name: string): Promise<ExtensionInfo> => {
		const known = states.get(name);
		if (!known || !existsSync(join(known.candidate.dir, "extension.json"))) {
			await rescan();
			const found = states.get(name);
			if (!found && [...blocked.values()].some((info) => info.name === name))
				throw new Error(
					`extension "${name}" is in an untrusted project; trust the project to load it`,
				);
			if (!found) throw new Error(notFound(name));
			await found.queue;
			return infoOf(found);
		}
		return serialized(known, () => loadInto(known));
	};

	const findCandidate = async (name: string) =>
		(await discoverExtensions({ userDir: options.userDir, projectRoots })).candidates.find(
			(candidate) => candidate.name === name,
		);

	const dryLoad = async (candidate: Candidate): Promise<ExtValidation> => {
		const logs: string[] = [];
		const sink: Sink = {
			store: createDryStore(
				stores.get(candidate.name) ??
					createExtStore({ dir: options.storeDir, name: candidate.name }),
			),
			log: (level, message) => logs.push(`${level} ${message}`),
		};
		const prepared = await prepare(candidate, () => 0, sink);
		if (!prepared.ok) return { ...prepared, logs };
		await disposeGeneration(prepared.generation, sink.log);
		return { ok: true, surfaces: prepared.manifest.surfaces, build: prepared.assets.build, logs };
	};

	return {
		rescan,
		async setProjectRoots(roots: readonly ProjectRoot[], untrusted: readonly ProjectRoot[] = []) {
			projectRoots = roots;
			blockedRoots = untrusted;
			await rescan();
		},
		reload,
		roots,
		async validate(name: string): Promise<ExtValidation> {
			const known = states.get(name);
			if (known) return serialized(known, () => dryLoad(known.candidate));
			const candidate = await findCandidate(name);
			if (!candidate) return { ok: false, errors: [notFound(name)], logs: [] };
			return dryLoad(candidate);
		},
		list: () => [...[...states.values()].map(infoOf), ...blocked.values()],
		get: (name: string) => {
			const state = states.get(name);
			return state ? infoOf(state) : undefined;
		},
		observe({ sessionId, event }: SessionEventPayload) {
			let session: ReturnType<SessionReads["get"]> | null = null;
			for (const state of states.values()) {
				const observers = state.current?.observers.get(event.type);
				if (!observers || observers.size === 0) continue;
				session ??= options.sessions.get(sessionId);
				if (!session) return;
				for (const observer of observers) observer(event, session);
			}
		},
		piFactories: (): PiExtensionFactory[] =>
			[...states.values()].flatMap((state) => [...(state.current?.piFactories ?? [])]),
		piFactoryOwner: (factory: PiExtensionFactory) =>
			[...states.values()].find((state) => state.current?.piFactories.has(factory))?.candidate.name,
		snapshot(keys?: readonly string[]) {
			const entries = keys
				? keys.flatMap((key) => (channels.has(key) ? [[key, channels.get(key)] as const] : []))
				: [...channels];
			return Object.fromEntries(entries);
		},
		async invokeAction({
			ext,
			id,
			payload,
			ctx = {},
		}: {
			ext: string;
			id: string;
			payload?: unknown;
			ctx?: ActionCtx;
		}) {
			const state = states.get(ext);
			if (!state?.current) throw new Error(`extension "${ext}" is not loaded`);
			const handler = state.current.actions.get(id);
			if (!handler) throw new Error(`extension "${ext}" has no action "${id}"`);
			try {
				return await handler(payload, ctx);
			} catch (error) {
				log(ext, "error", `action ${id}: ${formatLog([error])}`);
				throw error;
			}
		},
		asset(name: string, build: string, file: string) {
			const assets = states.get(name)?.assets;
			return assets?.build === build ? assets.files.get(file) : undefined;
		},
		logs(name: string, since = 0) {
			return (logs.get(name) ?? []).filter((entry) => entry.at >= since);
		},
		setWatched,
		dropClient: (clientKey: string) => setWatched(clientKey, []),
		recordError(name: string, context: string, error: unknown) {
			log(name, "error", `${context}: ${formatLog([error])}`);
		},
		async dispose() {
			disposed = true;
			watcher?.dispose();
			blocked.clear();
			await Promise.all([...states.keys()].map(unload));
		},
	};
};

export type ExtHost = ReturnType<typeof createExtHost>;
