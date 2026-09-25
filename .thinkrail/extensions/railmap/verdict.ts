import { isAbsolute, posix } from "node:path";
import type { Analysis } from "./analyze";
import type { MayImportResult } from "./model";
import { canonicalPath, toRel } from "./scan";

interface Endpoint {
	module: string | null;
	file?: string;
	viaPackage?: boolean;
}

const cleanPath = (root: string, input: string) => {
	const rel = isAbsolute(input) ? toRel(root, canonicalPath(input)) : input;
	return posix.normalize(rel.replace(/^\.\//, "")).replace(/\/$/, "") || ".";
};

const endpoint = (analysis: Analysis, input: string): Endpoint | undefined => {
	if (analysis.nodes.has(input)) return { module: input };
	const rel = cleanPath(analysis.graph.root, input);
	if (analysis.files.has(rel)) return { module: analysis.fileModule(rel), file: rel };
	const prefix = `${rel}/`;
	const isDir = rel === "." || [...analysis.files].some((file) => file.startsWith(prefix));
	return isDir ? { module: analysis.dirModule(rel) } : undefined;
};

const target = (analysis: Analysis, from: Endpoint, input: string): Endpoint | undefined => {
	const direct = endpoint(analysis, input);
	if (direct) return direct;
	const hit = analysis.resolve(from.file ?? "index.ts", input);
	return hit
		? { module: analysis.fileModule(hit.target), file: hit.target, viaPackage: hit.viaPackage }
		: undefined;
};

export const mayImport = (analysis: Analysis, input: { from: string; to: string }) => {
	const from = endpoint(analysis, input.from);
	if (!from?.module)
		return {
			verdict: "unknown",
			reason: `"${input.from}" is not a module id, or a path inside a module of ${analysis.graph.root}.`,
		} satisfies MayImportResult;
	const to = target(analysis, from, input.to);
	if (!to?.module)
		return {
			verdict: "unknown",
			from: from.module,
			reason: `"${input.to}" resolves to no module: not a spec id, a path inside a module, or a workspace import.`,
		} satisfies MayImportResult;
	const pair = { from: from.module, to: to.module };
	if (pair.from === pair.to)
		return { verdict: "allowed", ...pair, reason: "Same module." } satisfies MayImportResult;
	const barrel = analysis.barrels.get(pair.to)?.[0];
	if (to.file && barrel && analysis.isBypass(pair.from, pair.to, to.file, to.viaPackage ?? false))
		return {
			verdict: "bypass",
			...pair,
			barrel,
			reason: `${to.file} is internal to ${pair.to}; import through its barrel ${barrel} instead.`,
		} satisfies MayImportResult;
	if (analysis.structural(pair.from, pair.to))
		return {
			verdict: "allowed",
			...pair,
			reason: "One module encloses the other (directory or spec parent).",
		} satisfies MayImportResult;
	const declared = analysis.declaredBy(pair.from, pair.to);
	if (declared)
		return {
			verdict: "allowed",
			...pair,
			reason: `Declared: ${declared.source} depends-on ${declared.target}.`,
		} satisfies MayImportResult;
	const dir = analysis.nodes.get(pair.from)?.dir ?? ".";
	return {
		verdict: "undeclared",
		...pair,
		reason: `No spec declares ${pair.from} → ${pair.to}. If the edge is intended, add ${pair.to} to depends-on in ${dir === "." ? "" : `${dir}/`}SPEC.md; otherwise import something ${pair.from} may use.`,
	} satisfies MayImportResult;
};

export const verdictText = (result: MayImportResult) =>
	[
		`${result.verdict.toUpperCase()}${result.from && result.to ? `: ${result.from} → ${result.to}` : ""}`,
		result.reason,
	].join("\n");
