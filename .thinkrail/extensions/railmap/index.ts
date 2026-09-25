import { type ActionCtx, defineExtension } from "@thinkrail/ext";
import { type ImportSite, isRecord, type ModuleFile, type RailmapGraph } from "./model";
import { railmapPi } from "./pi";
import { createRoots } from "./roots";
import { canonicalPath } from "./scan";

const STORE_KEY = "graphs";
const STORED_ROOTS = 4;
const SAVE_MS = 5_000;
const MAX_SITES = 300;

const isGraph = (value: unknown): value is RailmapGraph =>
	isRecord(value) &&
	typeof value.root === "string" &&
	Array.isArray(value.modules) &&
	Array.isArray(value.edges) &&
	Array.isArray(value.drift);

const stringField = (payload: unknown, key: string) =>
	isRecord(payload) && typeof payload[key] === "string" ? payload[key] : undefined;

const pairsOf = (payload: unknown) => {
	const pairs = isRecord(payload) ? payload.pairs : undefined;
	if (!Array.isArray(pairs)) return [];
	return pairs.flatMap((pair) =>
		Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string"
			? [[pair[0], pair[1]] as const]
			: [],
	);
};

export default defineExtension(async (tr) => {
	const watched = new Map<string, string>();
	const stored = await tr.store.get<unknown>(STORE_KEY);
	const graphs = new Map<string, RailmapGraph>(
		isRecord(stored)
			? Object.entries(stored).flatMap(([root, graph]) =>
					isGraph(graph) ? [[root, graph] as const] : [],
				)
			: [],
	);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	const save = () => {
		saveTimer = undefined;
		const recent = [...graphs.values()]
			.sort((a, b) => b.builtAt - a.builtAt)
			.slice(0, STORED_ROOTS);
		void tr.store
			.set(STORE_KEY, Object.fromEntries(recent.map((graph) => [graph.root, graph])))
			.catch((error: unknown) => tr.log("store write failed", error));
	};

	const publishRoot = (root: string) => {
		const value = roots.channel(root);
		if (!value) return;
		for (const [workspaceId, watchedRoot] of watched)
			if (watchedRoot === root) tr.publish(`graph:${workspaceId}`, value);
	};

	const roots = createRoots({
		log: (...args) => tr.log(...args),
		onUpdate: publishRoot,
		onEvict: (root) => {
			for (const [workspaceId, watchedRoot] of [...watched])
				if (watchedRoot === root) {
					watched.delete(workspaceId);
					tr.unpublish(`graph:${workspaceId}`);
				}
		},
		isPinned: (root) => [...watched.values()].includes(root),
		loadStale: async (root) => graphs.get(root),
		saveGraph: (graph) => {
			graphs.set(graph.root, graph);
			saveTimer ??= setTimeout(save, SAVE_MS);
		},
	});

	const rootOf = (ctx: ActionCtx) => {
		const workspace = ctx.workspaceId ? tr.workspaces.get(ctx.workspaceId) : undefined;
		return workspace ? canonicalPath(workspace.path) : undefined;
	};

	const isWorkspaceRoot = (cwd: string) => {
		const root = canonicalPath(cwd);
		return tr.workspaces.list().some((workspace) => canonicalPath(workspace.path) === root);
	};

	const analysisOf = async (ctx: ActionCtx) => {
		const root = rootOf(ctx);
		if (!root) throw new Error("railmap: the view has no workspace");
		return roots.current(root);
	};

	tr.action("watch", (_payload, ctx) => {
		const root = rootOf(ctx);
		if (!root || !ctx.workspaceId) return { watching: false };
		watched.set(ctx.workspaceId, root);
		roots.ensure(root);
		publishRoot(root);
		return { watching: true, root };
	});

	tr.action("rebuild", (_payload, ctx) => {
		const root = rootOf(ctx);
		if (!root || !ctx.workspaceId) return { rebuilding: false };
		watched.set(ctx.workspaceId, root);
		roots.rebuild(root);
		publishRoot(root);
		return { rebuilding: true };
	});

	tr.action("files", async (payload, ctx) => {
		const module = stringField(payload, "module");
		const analysis = await analysisOf(ctx);
		const files: ModuleFile[] = [...analysis.resolved]
			.filter(([path]) => analysis.fileModule(path) === module)
			.map(([path, imports]) => ({ path, imports }))
			.sort((a, b) => a.path.localeCompare(b.path));
		return { files };
	});

	tr.action("sites", async (payload, ctx) => {
		const analysis = await analysisOf(ctx);
		const sites: ImportSite[] = pairsOf(payload).flatMap(
			([from, to]) => analysis.edges.get(`${from}>${to}`)?.sites ?? [],
		);
		return { sites: sites.slice(0, MAX_SITES), total: sites.length };
	});

	tr.pi(railmapPi({ roots, isWorkspaceRoot }));

	return () => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			save();
		}
		roots.dispose();
	};
});
