import { posix } from "node:path";
import { buildGraph, type Frontmatter, linkTargets } from "pi-spec-graph/core";
import {
	DRIFT_KINDS,
	type Drift,
	type FileImport,
	type ImportSite,
	type ModuleEdge,
	type ModuleInfo,
	type RailmapGraph,
} from "./model";
import { createResolver, isTestFile, type PackageInfo, packageExportFiles } from "./resolve";

export interface ImportRef {
	specifier: string;
	line: number;
}

export interface ScanState {
	files: Set<string>;
	sources: Map<string, ImportRef[]>;
	specs: Map<string, Frontmatter>;
	packages: Map<string, PackageInfo>;
}

export const emptyScan = (): ScanState => ({
	files: new Set(),
	sources: new Map(),
	specs: new Map(),
	packages: new Map(),
});

const SPEC_FILE = "SPEC.md";
const EXAMPLE_SITES = 3;

const parentDir = (dir: string) => (dir === "." ? undefined : posix.dirname(dir));

const labelOf = (title: string | undefined, dir: string) =>
	title?.split(" — ")[0]?.trim() || posix.basename(dir === "." ? "root" : dir);

const moduleTable = (scan: ScanState) => {
	const graph = buildGraph([...scan.specs].map(([path, frontmatter]) => ({ path, frontmatter })));
	const dirToId = new Map<string, string>();
	const nodes = new Map<string, { dir: string; title: string; frontmatter: Frontmatter }>();
	for (const node of graph.nodes.values()) {
		if (posix.basename(node.path) !== SPEC_FILE) continue;
		const dir = posix.dirname(node.path);
		if (dirToId.has(dir)) continue;
		dirToId.set(dir, node.id);
		nodes.set(node.id, { dir, title: node.title ?? node.id, frontmatter: node.frontmatter });
	}
	const dirModuleCache = new Map<string, string | null>();
	const dirModule = (dir: string): string | null => {
		const cached = dirModuleCache.get(dir);
		if (cached !== undefined) return cached;
		const own = dirToId.get(dir);
		const up = parentDir(dir);
		const found = own ?? (up === undefined ? null : dirModule(up));
		dirModuleCache.set(dir, found);
		return found;
	};
	const dirParent = (id: string) => {
		const up = parentDir(nodes.get(id)?.dir ?? ".");
		return up === undefined ? null : dirModule(up);
	};
	const specParent = (id: string) => {
		const parent = linkTargets(nodes.get(id)?.frontmatter ?? {}, "parent")[0];
		return parent !== undefined && nodes.has(parent) ? parent : null;
	};
	const ancestorCache = new Map<string, Set<string>>();
	const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
		const cached = ancestorCache.get(id);
		if (cached) return cached;
		const result = new Set<string>();
		seen.add(id);
		for (const parent of [dirParent(id), specParent(id)]) {
			if (parent === null || seen.has(parent)) continue;
			result.add(parent);
			for (const up of ancestors(parent, seen)) result.add(up);
		}
		seen.delete(id);
		ancestorCache.set(id, result);
		return result;
	};
	return { nodes, dirToId, dirModule, dirParent, specParent, ancestors };
};

export const analyze = (scan: ScanState, root: string) => {
	const table = moduleTable(scan);
	const { nodes, dirModule, ancestors } = table;
	const resolve = createResolver(scan.files, scan.packages);
	const fileModule = (file: string) => dirModule(posix.dirname(file));
	const within = (inner: string, outer: string) => inner === outer || ancestors(inner).has(outer);
	const structural = (a: string, b: string) => within(a, b) || within(b, a);
	const dependsOn = (id: string) =>
		linkTargets(nodes.get(id)?.frontmatter ?? {}, "depends-on").filter((target) =>
			nodes.has(target),
		);

	const barrels = new Map<string, string[]>();
	for (const [id, node] of nodes) {
		const own = ["index.ts", "index.tsx", "index.js", "index.mjs"]
			.map((name) => (node.dir === "." ? name : `${node.dir}/${name}`))
			.filter((path) => scan.files.has(path));
		const pkg = scan.packages.get(node.dir);
		const exported = pkg ? packageExportFiles(scan.files, node.dir, pkg) : [];
		barrels.set(id, [...new Set([...own, ...exported])]);
	}

	const declaredBy = (from: string, to: string) => {
		const sources = [from, ...ancestors(from)];
		const targets = new Set([to, ...ancestors(to)]);
		for (const source of sources)
			for (const target of dependsOn(source)) if (targets.has(target)) return { source, target };
		return undefined;
	};

	const isBypass = (from: string, to: string, target: string, viaPackage: boolean) => {
		if (viaPackage || within(from, to)) return false;
		const list = barrels.get(to) ?? [];
		return list.length > 0 && !list.includes(target);
	};

	const resolved = new Map<string, FileImport[]>();
	const edges = new Map<string, ModuleEdge & { sites: ImportSite[] }>();
	const bypassDrift: Drift[] = [];
	const ownFiles = new Map<string, number>();
	const unowned = new Map<string, number>();

	for (const [file, refs] of scan.sources) {
		const from = fileModule(file);
		if (from === null) {
			const dir = posix.dirname(file);
			if (dir !== ".") unowned.set(dir, (unowned.get(dir) ?? 0) + 1);
		} else ownFiles.set(from, (ownFiles.get(from) ?? 0) + 1);
		const imports: FileImport[] = [];
		for (const ref of refs) {
			const hit = resolve(file, ref.specifier);
			if (!hit) continue;
			const to = fileModule(hit.target);
			const bypass =
				from !== null && to !== null && !isTestFile(file) && from !== to
					? isBypass(from, to, hit.target, hit.viaPackage)
					: false;
			imports.push({ ...ref, target: hit.target, module: to, bypass });
			if (from === null || to === null || from === to) continue;
			const key = `${from}>${to}`;
			const edge = edges.get(key) ?? {
				from,
				to,
				imports: 0,
				declared: declaredBy(from, to) !== undefined,
				structural: structural(from, to),
				bypass: 0,
				sites: [],
			};
			edge.imports += 1;
			if (bypass) edge.bypass += 1;
			edge.sites.push({
				file,
				line: ref.line,
				specifier: ref.specifier,
				target: hit.target,
				from,
				to,
				bypass,
			});
			edges.set(key, edge);
			if (bypass) {
				const barrel = barrels.get(to)?.[0] ?? "index.ts";
				bypassDrift.push({
					key: `bypass:${file}>${hit.target}`,
					kind: "bypass",
					detail: `${file}:${ref.line} imports ${hit.target}, not the ${nodes.get(to)?.dir ?? to} barrel (${barrel})`,
					from,
					to,
					file,
					line: ref.line,
					target: hit.target,
				});
			}
		}
		resolved.set(file, imports);
	}

	const undeclaredDrift: Drift[] = [...edges.values()]
		.filter((edge) => !edge.declared && !edge.structural)
		.map((edge) => {
			const first = edge.sites[0];
			const examples = edge.sites
				.slice(0, EXAMPLE_SITES)
				.map((site) => `${site.file}:${site.line}`)
				.join(", ");
			return {
				key: `undeclared:${edge.from}>${edge.to}`,
				kind: "undeclared" as const,
				detail: `${edge.from} → ${edge.to}: ${edge.imports} import${edge.imports === 1 ? "" : "s"} (${examples}), no depends-on covers it`,
				from: edge.from,
				to: edge.to,
				count: edge.imports,
				...(first ? { file: first.file, line: first.line } : {}),
			};
		});

	const covered = new Set<string>();
	for (const edge of edges.values())
		for (const a of [edge.from, ...ancestors(edge.from)])
			for (const b of [edge.to, ...ancestors(edge.to)]) covered.add(`${a}>${b}`);
	const subtreeFiles = new Map<string, number>();
	for (const [id, count] of ownFiles)
		for (const holder of [id, ...ancestors(id)])
			subtreeFiles.set(holder, (subtreeFiles.get(holder) ?? 0) + count);
	const unusedDrift: Drift[] = [];
	for (const id of nodes.keys()) {
		if ((subtreeFiles.get(id) ?? 0) === 0) continue;
		for (const target of dependsOn(id)) {
			if (structural(id, target) || covered.has(`${id}>${target}`)) continue;
			unusedDrift.push({
				key: `unused:${id}>${target}`,
				kind: "unused",
				detail: `${id} declares depends-on ${target}, but no file under ${nodes.get(id)?.dir} imports ${nodes.get(target)?.dir}`,
				from: id,
				to: target,
			});
		}
	}

	const holdsModule = new Set<string>();
	for (const node of nodes.values())
		for (let dir: string | undefined = node.dir; dir !== undefined; dir = parentDir(dir))
			holdsModule.add(dir);
	const noSpec = new Map<string, number>();
	for (const [dir, count] of unowned) {
		let top = dir;
		for (
			let up = parentDir(top);
			up !== undefined && up !== "." && !holdsModule.has(up);
			up = parentDir(up)
		)
			top = up;
		noSpec.set(top, (noSpec.get(top) ?? 0) + count);
	}
	const noSpecDrift: Drift[] = [...noSpec].map(([dir, count]) => ({
		key: `no-spec:${dir}`,
		kind: "no-spec",
		detail: `${dir}: ${count} code file${count === 1 ? "" : "s"} with no owning SPEC.md`,
		dir,
		count,
	}));

	const kindOrder = (drift: Drift) => DRIFT_KINDS.indexOf(drift.kind);
	const all =
		nodes.size === 0 ? [] : [...undeclaredDrift, ...bypassDrift, ...unusedDrift, ...noSpecDrift];
	const drift = all.sort((a, b) => kindOrder(a) - kindOrder(b) || a.key.localeCompare(b.key));

	const modules: ModuleInfo[] = [...nodes]
		.map(([id, node]) => ({
			id,
			dir: node.dir,
			label: labelOf(node.title, node.dir),
			title: node.title,
			parent: table.dirParent(id) ?? table.specParent(id),
			ancestors: [...ancestors(id)],
			files: ownFiles.get(id) ?? 0,
			barrels: barrels.get(id) ?? [],
			dependsOn: dependsOn(id),
		}))
		.sort((a, b) => a.dir.localeCompare(b.dir));

	const graph: RailmapGraph = {
		root,
		modules,
		edges: [...edges.values()]
			.map(({ sites: _sites, ...edge }) => edge)
			.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
		drift,
		files: scan.sources.size,
		builtAt: Date.now(),
	};

	return {
		graph,
		resolved,
		edges,
		nodes,
		barrels,
		fileModule,
		dirModule,
		structural,
		declaredBy,
		isBypass,
		resolve,
		files: scan.files,
	};
};

export type Analysis = ReturnType<typeof analyze>;
