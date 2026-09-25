import type { ExtensionInfo, ExtensionSurface, SessionEventPayload } from "@thinkrail/contracts";
import type { ActionCtx, ExtStore, PiExtensionFactory } from "@thinkrail/ext";
import { type Candidate, discoverExtensions, type ProjectRoot } from "./discovery";
import { createGeneration, type Generation } from "./generation";
import { importExtension } from "./loader";
import { readManifest } from "./manifest";
import { createExtStore } from "./store";
import { createTr, formatLog, type SessionReads } from "./tr";
import { errorMessage } from "./util";

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
	onPiFactoriesChanged?: () => void;
	onChanged?: (info: ExtensionInfo) => void;
	onRemoved?: (name: string) => void;
	onChannel?: (key: string, value: unknown) => void;
	warn?: (message: string) => void;
}

interface ExtState {
	candidate: Candidate;
	title: string;
	surfaces: ExtensionSurface[];
	permissions: string[];
	current: Generation | undefined;
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
	...(state.error !== undefined ? { error: state.error } : {}),
});

const sameCandidate = (a: Candidate, b: Candidate) =>
	a.dir === b.dir && a.scope === b.scope && a.projectId === b.projectId;

export const createExtHost = (options: ExtHostOptions) => {
	const states = new Map<string, ExtState>();
	const stores = new Map<string, ExtStore>();
	const logs = new Map<string, ExtLogEntry[]>();
	const channels = new Map<string, unknown>();
	let projectRoots: readonly ProjectRoot[] = [];
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

	const disposeGeneration = async (name: string, generation: Generation) => {
		const failures = await generation.dispose();
		for (const failure of failures) log(name, "error", `dispose: ${formatLog([failure])}`);
	};

	const serialized = <T>(state: ExtState, task: () => Promise<T>) => {
		const run = state.queue.then(task);
		state.queue = run.catch(() => {});
		return run;
	};

	const loadInto = async (state: ExtState) => {
		const { name, dir } = state.candidate;
		const fail = (message: string) => {
			state.error = message;
			log(name, "error", `load failed: ${message}`);
			options.onChanged?.(infoOf(state));
			return infoOf(state);
		};
		const manifest = await readManifest(dir);
		if (!manifest.ok) return fail(manifest.errors.join("\n"));
		let factory: Awaited<ReturnType<typeof importExtension>>;
		try {
			factory = await importExtension(dir);
		} catch (error) {
			return fail(`index.ts: ${errorMessage(error)}`);
		}
		const generation = createGeneration({ id: nextGeneration++, emit: emitChannel });
		const tr = createTr({
			name,
			dir,
			generation,
			store: storeFor(name),
			sessions: options.sessions,
			log: (level, message) => log(name, level, message),
		});
		try {
			const cleanup = await factory(tr);
			if (typeof cleanup === "function") generation.addDisposer(cleanup);
		} catch (error) {
			await disposeGeneration(name, generation);
			return fail(`factory threw: ${errorMessage(error)}`);
		}
		if (disposed || states.get(name) !== state) {
			await disposeGeneration(name, generation);
			return infoOf(state);
		}
		const previous = state.current;
		state.current = generation;
		state.error = undefined;
		state.title = manifest.manifest.title;
		state.surfaces = manifest.manifest.surfaces;
		state.permissions = manifest.manifest.permissions;
		generation.activate();
		if (previous) await disposeGeneration(name, previous);
		log(name, "info", `generation ${generation.id} active`);
		if (previous?.piFactories.size || generation.piFactories.size) options.onPiFactoriesChanged?.();
		options.onChanged?.(infoOf(state));
		return infoOf(state);
	};

	const stateFor = (candidate: Candidate): ExtState => ({
		candidate,
		title: candidate.name,
		surfaces: [],
		permissions: [],
		current: undefined,
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
			const hadPiFactories = (generation?.piFactories.size ?? 0) > 0;
			if (generation) await disposeGeneration(name, generation);
			for (const key of [...channels.keys()]) if (key.startsWith(`${name}:`)) channels.delete(key);
			if (disposed) return;
			options.onRemoved?.(name);
			if (hadPiFactories) options.onPiFactoriesChanged?.();
		});
	};

	const rescan = async () => {
		const { candidates, duplicates } = await discoverExtensions({
			userDir: options.userDir,
			projectRoots,
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
		const loads: Promise<unknown>[] = [];
		for (const candidate of candidates) {
			if (states.has(candidate.name)) continue;
			const state = stateFor(candidate);
			states.set(candidate.name, state);
			loads.push(serialized(state, () => loadInto(state)));
		}
		await Promise.all(loads);
	};

	return {
		rescan,
		async setProjectRoots(roots: readonly ProjectRoot[]) {
			projectRoots = roots;
			await rescan();
		},
		async reload(name: string): Promise<ExtensionInfo> {
			const known = states.get(name);
			if (!known) {
				await rescan();
				const found = states.get(name);
				if (!found) throw new Error(`extension "${name}" not found`);
				await found.queue;
				return infoOf(found);
			}
			return serialized(known, () => loadInto(known));
		},
		list: () => [...states.values()].map(infoOf),
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
		logs(name: string, since = 0) {
			return (logs.get(name) ?? []).filter((entry) => entry.at >= since);
		},
		recordError(name: string, message: string) {
			log(name, "error", message);
		},
		async dispose() {
			disposed = true;
			await Promise.all([...states.keys()].map(unload));
		},
	};
};

export type ExtHost = ReturnType<typeof createExtHost>;
