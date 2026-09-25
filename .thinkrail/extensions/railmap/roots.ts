import { watch } from "node:fs";
import { isAbsolute, sep } from "node:path";
import { type Analysis, analyze, emptyScan, type ScanState } from "./analyze";
import type { RailmapChannel, RailmapGraph, RailmapStatus } from "./model";
import { applyChanges, canonicalPath, coldScan, isIgnored, toRel } from "./scan";

const MAX_ROOTS = 4;
const DEBOUNCE_MS = 150;
const PROGRESS_MS = 250;

interface RootEntry {
	root: string;
	scan: ScanState;
	analysis: Analysis | undefined;
	stale: RailmapGraph | undefined;
	status: RailmapStatus;
	queue: Promise<unknown>;
	ready: Promise<Analysis>;
	pending: Set<string>;
	timer: ReturnType<typeof setTimeout> | undefined;
	progressAt: number;
	usedAt: number;
	closeWatch: () => void;
	disposed: boolean;
}

export interface RootsOptions {
	log: (...args: unknown[]) => void;
	onUpdate: (root: string) => void;
	onEvict: (root: string) => void;
	isPinned: (root: string) => boolean;
	loadStale: (root: string) => Promise<RailmapGraph | undefined>;
	saveGraph: (graph: RailmapGraph) => void;
}

const watchTree = (
	root: string,
	onPath: (rel: string) => void,
	onError: (error: unknown) => void,
) => {
	try {
		const watcher = watch(root, { recursive: true }, (_event, filename) => {
			if (filename) onPath(String(filename).split(sep).join("/"));
		});
		watcher.on("error", onError);
		return () => watcher.close();
	} catch (error) {
		onError(error);
		return () => {};
	}
};

export const createRoots = (options: RootsOptions) => {
	const entries = new Map<string, RootEntry>();
	let closed = false;

	const settle = (entry: Pick<RootEntry, "root" | "analysis" | "disposed">) => {
		if (entry.disposed || !entry.analysis) return;
		options.onUpdate(entry.root);
		options.saveGraph(entry.analysis.graph);
	};

	const flush = (entry: RootEntry) => {
		if (entry.timer) clearTimeout(entry.timer);
		entry.timer = undefined;
		if (entry.pending.size === 0) return entry.queue;
		const paths = [...entry.pending];
		entry.pending.clear();
		entry.queue = entry.queue
			.then(async () => {
				await applyChanges(entry.scan, entry.root, paths);
				entry.analysis = analyze(entry.scan, entry.root);
				settle(entry);
			})
			.catch((error: unknown) => options.log(`update ${entry.root} failed`, error));
		return entry.queue;
	};

	const queuePath = (entry: RootEntry, rel: string) => {
		if (rel === "" || rel.startsWith("..") || isIgnored(rel)) return;
		entry.pending.add(rel);
		if (entry.timer) clearTimeout(entry.timer);
		entry.timer = setTimeout(() => void flush(entry), DEBOUNCE_MS);
	};

	const dispose = (entry: RootEntry) => {
		entry.disposed = true;
		if (entry.timer) clearTimeout(entry.timer);
		entry.closeWatch();
		entries.delete(entry.root);
	};

	const evict = () => {
		const byAge = [...entries.values()]
			.filter((entry) => !options.isPinned(entry.root))
			.sort((a, b) => a.usedAt - b.usedAt);
		for (const entry of byAge.slice(0, Math.max(0, entries.size - MAX_ROOTS))) {
			dispose(entry);
			options.onEvict(entry.root);
		}
	};

	const build = async (entry: Omit<RootEntry, "ready" | "queue">) => {
		entry.stale = await options.loadStale(entry.root).catch(() => undefined);
		if (!entry.disposed) options.onUpdate(entry.root);
		await coldScan(entry.scan, entry.root, (done, total) => {
			entry.status = { state: "building", done, total };
			const now = Date.now();
			if (now - entry.progressAt < PROGRESS_MS || entry.disposed) return;
			entry.progressAt = now;
			options.onUpdate(entry.root);
		});
		const analysis = analyze(entry.scan, entry.root);
		entry.analysis = analysis;
		entry.stale = undefined;
		entry.status = { state: "ready" };
		settle(entry);
		return analysis;
	};

	const ensure = (path: string) => {
		const root = canonicalPath(path);
		const existing = entries.get(root);
		if (existing) {
			existing.usedAt = Date.now();
			return existing;
		}
		const state: Omit<RootEntry, "ready" | "queue"> = {
			root,
			scan: emptyScan(),
			analysis: undefined,
			stale: undefined,
			status: { state: "building", done: 0, total: 0 },
			pending: new Set(),
			timer: undefined,
			progressAt: 0,
			usedAt: Date.now(),
			closeWatch: () => {},
			disposed: closed,
		};
		const ready = build(state);
		const entry: RootEntry = Object.assign(state, { ready, queue: ready.catch(() => {}) });
		ready.catch((error: unknown) => {
			entry.status = {
				state: "error",
				error: error instanceof Error ? error.message : String(error),
			};
			options.log(`build ${root} failed`, error);
			if (!entry.disposed) options.onUpdate(root);
		});
		if (closed) return entry;
		entries.set(root, entry);
		entry.closeWatch = watchTree(
			root,
			(rel) => queuePath(entry, rel),
			(error) => options.log(`watch ${root} failed`, error),
		);
		evict();
		return entry;
	};

	return {
		ensure: (path: string) => ensure(path).root,
		async current(path: string, touched: readonly string[] = []) {
			const entry = ensure(path);
			await entry.ready;
			for (const file of touched) {
				const rel = isAbsolute(file) ? toRel(entry.root, canonicalPath(file)) : file;
				if (!rel.startsWith("..")) entry.pending.add(rel);
			}
			await flush(entry);
			if (!entry.analysis) throw new Error(`railmap: no graph for ${entry.root}`);
			return entry.analysis;
		},
		channel(root: string): RailmapChannel | undefined {
			const entry = entries.get(root);
			if (!entry) return undefined;
			const graph = entry.analysis?.graph ?? entry.stale;
			return {
				root,
				status: entry.status,
				...(graph ? { graph } : {}),
				...(!entry.analysis && entry.stale ? { stale: true } : {}),
			};
		},
		rebuild(path: string) {
			const entry = entries.get(canonicalPath(path));
			if (entry) dispose(entry);
			return ensure(path).root;
		},
		dispose() {
			closed = true;
			for (const entry of [...entries.values()]) dispose(entry);
		},
	};
};

export type Roots = ReturnType<typeof createRoots>;
