export const DRIFT_MESSAGE = "railmap-drift";
export const DRIFT_KINDS = ["undeclared", "bypass", "unused", "no-spec"] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

export interface ModuleInfo {
	id: string;
	dir: string;
	label: string;
	title: string;
	parent: string | null;
	ancestors: string[];
	files: number;
	barrels: string[];
	dependsOn: string[];
}

export interface ModuleEdge {
	from: string;
	to: string;
	imports: number;
	declared: boolean;
	structural: boolean;
	bypass: number;
}

export interface Drift {
	key: string;
	kind: DriftKind;
	detail: string;
	from?: string;
	to?: string;
	file?: string;
	line?: number;
	target?: string;
	dir?: string;
	count?: number;
}

export interface RailmapGraph {
	root: string;
	modules: ModuleInfo[];
	edges: ModuleEdge[];
	drift: Drift[];
	files: number;
	builtAt: number;
}

export type RailmapStatus =
	| { state: "building"; done: number; total: number }
	| { state: "ready" }
	| { state: "error"; error: string };

export interface RailmapChannel {
	root: string;
	status: RailmapStatus;
	graph?: RailmapGraph;
	stale?: boolean;
}

export interface ImportSite {
	file: string;
	line: number;
	specifier: string;
	target: string;
	from: string;
	to: string;
	bypass: boolean;
}

export interface FileImport {
	line: number;
	specifier: string;
	target: string;
	module: string | null;
	bypass: boolean;
}

export interface ModuleFile {
	path: string;
	imports: FileImport[];
}

export type Verdict = "allowed" | "undeclared" | "bypass" | "unknown";

export interface MayImportResult {
	verdict: Verdict;
	from?: string;
	to?: string;
	reason: string;
	barrel?: string;
}

export interface DriftMessageDetails {
	root: string;
	items: Drift[];
	total: number;
}

export const driftCounts = (drift: readonly Drift[]) => {
	const counts: Record<DriftKind, number> = { undeclared: 0, bypass: 0, unused: 0, "no-spec": 0 };
	for (const item of drift) counts[item.kind] += 1;
	return counts;
};

export const DRIFT_LABEL: Record<DriftKind, string> = {
	undeclared: "Undeclared edge",
	bypass: "Barrel bypass",
	unused: "Declared, unused",
	"no-spec": "Code without spec",
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const fixPrompt = (item: Drift, root: string) =>
	[
		`Railmap found spec drift in ${root}:`,
		"",
		`- ${DRIFT_LABEL[item.kind]}: ${item.detail}`,
		"",
		item.kind === "undeclared"
			? "Either remove the import, route it through a module the specs allow, or, if the edge is intended, add it to `depends-on` in the importing module's SPEC.md (and describe it there)."
			: item.kind === "bypass"
				? "Import through the target module's barrel (`index.ts`), exporting the symbol there if it is meant to be public."
				: item.kind === "unused"
					? "Remove the stale `depends-on` entry from the SPEC.md, or confirm the dependency is real and not an import (then leave it)."
					: "Give this code an owning module: add a SPEC.md (responsibility, public surface, allowed deps) or move the code under an existing module.",
		"Check the result with the `may_import` tool before you finish.",
	].join("\n");
