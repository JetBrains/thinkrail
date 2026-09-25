import type { DriftKind, ModuleEdge, ModuleFile, ModuleInfo, RailmapGraph } from "./model";

export type EdgeState = "undeclared" | "declared" | "structural" | "unused";
export type NodeKind = "module" | "self" | "external" | "file";

export interface LevelNode {
	id: string;
	label: string;
	sublabel: string;
	kind: NodeKind;
	modules: string[];
	drillable: boolean;
	drift: number;
}

export interface LevelEdge {
	id: string;
	source: string;
	target: string;
	state: EdgeState;
	imports: number;
	bypass: number;
	pairs: [string, string][];
}

export interface Level {
	nodes: LevelNode[];
	edges: LevelEdge[];
}

export const moduleIndex = (graph: RailmapGraph) => new Map(graph.modules.map((m) => [m.id, m]));

type Index = ReturnType<typeof moduleIndex>;

const chainOf = (index: Index, id: string) => {
	const chain: string[] = [];
	for (
		let at: string | null = id;
		at !== null && !chain.includes(at);
		at = index.get(at)?.parent ?? null
	)
		chain.push(at);
	return chain;
};

export const childrenOf = (graph: RailmapGraph, id: string | null) =>
	graph.modules.filter((module) => module.parent === id);

export const subtreeOf = (index: Index, id: string) => {
	const ids = new Set<string>();
	for (const module of index.values())
		if (chainOf(index, module.id).includes(id)) ids.add(module.id);
	return ids;
};

const groupOf = (index: Index, focus: string | null, id: string) => {
	const chain = chainOf(index, id);
	if (focus === null) return { group: chain[chain.length - 1] ?? id, external: false };
	const at = chain.indexOf(focus);
	if (at === 0) return { group: `self:${focus}`, external: false };
	if (at > 0) return { group: chain[at - 1] ?? id, external: false };
	const around = new Set(chainOf(index, focus));
	const outer = chain.find((link) => {
		const parent = index.get(link)?.parent ?? null;
		return parent === null || around.has(parent);
	});
	return { group: outer ?? id, external: true };
};

const edgeState = (edge: Pick<ModuleEdge, "declared" | "structural">): EdgeState =>
	edge.structural ? "structural" : edge.declared ? "declared" : "undeclared";

const STATE_RANK: Record<EdgeState, number> = {
	undeclared: 3,
	declared: 2,
	structural: 1,
	unused: 0,
};

export const driftByModule = (graph: RailmapGraph, kinds: ReadonlySet<DriftKind>) => {
	const counts = new Map<string, number>();
	for (const item of graph.drift)
		if (item.from && kinds.has(item.kind)) counts.set(item.from, (counts.get(item.from) ?? 0) + 1);
	return counts;
};

const labelOf = (module: ModuleInfo | undefined, id: string) => module?.label ?? id;

export const moduleLevel = (
	graph: RailmapGraph,
	focus: string | null,
	kinds: ReadonlySet<DriftKind>,
): Level => {
	const index = moduleIndex(graph);
	const drift = driftByModule(graph, kinds);
	const nodes = new Map<string, LevelNode>();
	const place = (id: string) => {
		const { group, external } = groupOf(index, focus, id);
		const existing = nodes.get(group);
		if (existing) {
			if (!existing.modules.includes(id)) existing.modules.push(id);
			return group;
		}
		const self = group.startsWith("self:");
		const moduleId = self ? group.slice("self:".length) : group;
		const module = index.get(moduleId);
		nodes.set(group, {
			id: group,
			label: self ? `${labelOf(module, moduleId)} (own files)` : labelOf(module, moduleId),
			sublabel: module?.dir ?? moduleId,
			kind: self ? "self" : external ? "external" : "module",
			modules: [id],
			drillable: self || childrenOf(graph, moduleId).length > 0 || (module?.files ?? 0) > 0,
			drift: 0,
		});
		return group;
	};
	if (focus === null) for (const module of graph.modules) place(module.id);
	else
		for (const id of subtreeOf(index, focus))
			if (id !== focus || (index.get(id)?.files ?? 0) > 0) place(id);

	const edges = new Map<string, LevelEdge>();
	const addEdge = (from: string, to: string, state: EdgeState, edge?: ModuleEdge) => {
		const inside = (id: string) => !groupOf(index, focus, id).external;
		if (!inside(from) && !inside(to)) return;
		const source = place(from);
		const target = place(to);
		if (source === target) return;
		const id = `${source}>${target}`;
		const current = edges.get(id) ?? {
			id,
			source,
			target,
			state,
			imports: 0,
			bypass: 0,
			pairs: [],
		};
		if (STATE_RANK[state] > STATE_RANK[current.state]) current.state = state;
		current.imports += edge?.imports ?? 0;
		current.bypass += edge?.bypass ?? 0;
		if (edge) current.pairs.push([from, to]);
		edges.set(id, current);
	};
	for (const edge of graph.edges) addEdge(edge.from, edge.to, edgeState(edge), edge);
	if (kinds.has("unused"))
		for (const item of graph.drift)
			if (item.kind === "unused" && item.from && item.to) addEdge(item.from, item.to, "unused");

	for (const node of nodes.values())
		node.drift = node.modules.reduce((sum, id) => sum + (drift.get(id) ?? 0), 0);
	return { nodes: [...nodes.values()], edges: [...edges.values()] };
};

export const fileLevel = (
	graph: RailmapGraph,
	module: string,
	files: readonly ModuleFile[],
): Level => {
	const index = moduleIndex(graph);
	const nodes = new Map<string, LevelNode>();
	const edges = new Map<string, LevelEdge>();
	const prefix = `${index.get(module)?.dir ?? ""}/`;
	for (const file of files)
		nodes.set(`file:${file.path}`, {
			id: `file:${file.path}`,
			label: file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path,
			sublabel: `${file.imports.length} import${file.imports.length === 1 ? "" : "s"}`,
			kind: "file",
			modules: [module],
			drillable: false,
			drift: file.imports.filter((entry) => entry.bypass).length,
		});
	for (const file of files) {
		const source = `file:${file.path}`;
		for (const entry of file.imports) {
			if (entry.module === null) continue;
			const internal = entry.module === module;
			let target = `file:${entry.target}`;
			if (!internal) {
				target = groupOf(index, module, entry.module).group;
				if (!nodes.has(target)) {
					const info = index.get(target);
					nodes.set(target, {
						id: target,
						label: labelOf(info, target),
						sublabel: info?.dir ?? target,
						kind: "external",
						modules: [target],
						drillable: false,
						drift: 0,
					});
				}
			}
			if (!nodes.has(target) || target === source) continue;
			const id = `${source}>${target}`;
			const edge = graph.edges.find(
				(candidate) => candidate.from === module && candidate.to === entry.module,
			);
			const state: EdgeState = internal ? "structural" : edge ? edgeState(edge) : "declared";
			const current = edges.get(id) ?? {
				id,
				source,
				target,
				state,
				imports: 0,
				bypass: 0,
				pairs: [],
			};
			if (STATE_RANK[state] > STATE_RANK[current.state]) current.state = state;
			current.imports += 1;
			if (entry.bypass) current.bypass += 1;
			if (!internal && !current.pairs.some(([, to]) => to === entry.module))
				current.pairs.push([module, entry.module]);
			edges.set(id, current);
		}
	}
	return { nodes: [...nodes.values()], edges: [...edges.values()] };
};

export const importersOf = (graph: RailmapGraph, targets: ReadonlySet<string>) => {
	const reverse = new Map<string, string[]>();
	for (const edge of graph.edges)
		reverse.set(edge.to, [...(reverse.get(edge.to) ?? []), edge.from]);
	const affected = new Set<string>();
	const queue = [...targets];
	while (queue.length > 0) {
		const next = queue.pop();
		if (next === undefined) break;
		for (const from of reverse.get(next) ?? [])
			if (!affected.has(from) && !targets.has(from)) {
				affected.add(from);
				queue.push(from);
			}
	}
	return affected;
};
