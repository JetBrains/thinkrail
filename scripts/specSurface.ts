import { dirname, join, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { FIELDS, list, parseFile, SpecIndex } from "pi-spec-graph/core";
import { fileExists, readBarrelExports } from "./barrelExports";

export const PUBLIC_SURFACE_TAG = "public-surface-checked";

const PUBLIC_SURFACE_LABEL = /^(?:owns\s*\/\s*)?public surface\b/i;
const HEADING = /^#{1,6}\s/;
const TOP_LEVEL_BULLET = /^[-*+]\s\*\*/;
const BULLET = /^\s*[-*+]\s/;
const BULLET_LABEL = /^\s*[-*+]\s+\*\*([^*]+)\*\*/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LIST_SEPARATORS = /[,;./\s]/g;

export interface SurfaceBlock {
	text: string;
	heading: boolean;
}

interface MarkdownNode {
	type: string;
	children?: readonly MarkdownNode[];
	position?: { start: { line: number }; end: { line: number } };
}

interface MarkdownView {
	lines: string[];
	tree: MarkdownNode;
}

function markdownView(text: string): MarkdownView {
	const tree = fromMarkdown(text) as MarkdownNode;
	const hiddenLines = new Set<number>();
	const visit = (node: MarkdownNode): void => {
		if ((node.type === "code" || node.type === "html") && node.position !== undefined) {
			for (let line = node.position.start.line; line <= node.position.end.line; line++) {
				hiddenLines.add(line);
			}
			return;
		}
		for (const child of node.children ?? []) visit(child);
	};
	visit(tree);
	return {
		lines: text.split("\n").map((line, index) => (hiddenLines.has(index + 1) ? "" : line)),
		tree,
	};
}

function enclosingNode(tree: MarkdownNode, type: string, line: number): MarkdownNode | null {
	let found: MarkdownNode | null = null;
	const visit = (node: MarkdownNode): void => {
		const position = node.position;
		if (position === undefined || line < position.start.line || line > position.end.line) return;
		if (node.type === type) found = node;
		for (const child of node.children ?? []) visit(child);
	};
	visit(tree);
	return found;
}

function declaredByLabel(line: string): boolean {
	if (HEADING.test(line)) {
		return PUBLIC_SURFACE_LABEL.test(line.replace(/^#{1,6}\s+/, ""));
	}
	const label = BULLET_LABEL.exec(line)?.[1];
	return label !== undefined && PUBLIC_SURFACE_LABEL.test(label);
}

function declaredInProse(line: string): boolean {
	return !HEADING.test(line) && !BULLET.test(line) && PUBLIC_SURFACE_LABEL.test(line.trimStart());
}

export function readSurfaceBlock(specText: string): SurfaceBlock | null {
	const view = markdownView(specText);
	const labelled = view.lines.findIndex(declaredByLabel);
	const start = labelled === -1 ? view.lines.findIndex(declaredInProse) : labelled;
	const first = view.lines[start];
	if (start === -1 || first === undefined) return null;
	const heading = HEADING.test(first);
	if (heading) {
		const nextHeading = view.lines.findIndex((line, index) => index > start && HEADING.test(line));
		const end = nextHeading === -1 ? view.lines.length : nextHeading;
		return { text: view.lines.slice(start, end).join("\n"), heading: true };
	}
	const type = BULLET_LABEL.test(first) ? "listItem" : "paragraph";
	const container = enclosingNode(view.tree, type, start + 1);
	if (container?.position !== undefined) {
		return {
			text: view.lines.slice(start, container.position.end.line).join("\n"),
			heading: false,
		};
	}
	const collected = [first];
	for (let index = start + 1; index < view.lines.length; index++) {
		const line = view.lines[index] ?? "";
		if (HEADING.test(line) || TOP_LEVEL_BULLET.test(line) || line.trim() === "") break;
		collected.push(line);
	}
	return { text: collected.join("\n"), heading: false };
}

function body(block: SurfaceBlock): string {
	if (block.heading) return block.text.split("\n").slice(1).join("\n");
	const label = BULLET_LABEL.exec(block.text);
	return label === null ? block.text : block.text.slice(label[0].length);
}

function withoutMarkers(text: string): string {
	return text
		.split("\n")
		.map((line) => line.replace(/^\s*[-*+]\s+/, ""))
		.join("\n");
}

function spans(text: string): string[] {
	return [...text.matchAll(/`([^`]+)`/g)].map((match) => (match[1] ?? "").trim());
}

export function isBareNameList(block: SurfaceBlock): boolean {
	const text = body(block);
	const named = spans(text);
	if (named.length === 0) return false;
	if (named.some((span) => !IDENTIFIER.test(span.replace(/^type\s+/, "")))) return false;
	return (
		withoutMarkers(text)
			.replace(/`[^`]*`/g, "")
			.replace(LIST_SEPARATORS, "") === ""
	);
}

export function declaredNames(block: SurfaceBlock): string[] {
	const names = new Set<string>();
	for (const span of spans(body(block))) {
		const name = span.replace(/^type\s+/, "");
		if (IDENTIFIER.test(name)) names.add(name);
	}
	return [...names].sort();
}

export interface SurfaceDiff {
	promised: string[];
	undeclared: string[];
}

export function diffSurface(declared: string[], exported: string[]): SurfaceDiff {
	const exportedSet = new Set(exported);
	const declaredSet = new Set(declared);
	return {
		promised: declared.filter((name) => !exportedSet.has(name)).sort(),
		undeclared: exported.filter((name) => !declaredSet.has(name)).sort(),
	};
}

export interface SurfaceSkip {
	path: string;
	reason: string;
}

export interface SurfaceCheckReport {
	enrolled: number;
	checked: number;
	skipped: SurfaceSkip[];
	violations: string[];
}

interface SurfaceCandidate {
	specPath: string;
	barrel: string;
	declared: string[];
}

function barrelFor(specFile: string): string | null {
	for (const candidate of [
		join(dirname(specFile), "index.ts"),
		join(dirname(specFile), "src", "index.ts"),
	]) {
		if (fileExists(candidate)) return resolve(candidate);
	}
	return null;
}

function skippedReason(block: SurfaceBlock | null, barrel: string | null): string {
	if (block === null) return "not enrolled; no public surface";
	if (!isBareNameList(block)) return "not enrolled; surface written as prose";
	if (barrel === null) return "not enrolled; no barrel to compare against";
	return "not enrolled";
}

export async function checkSpecSurfaces(inputRoot: string): Promise<SurfaceCheckReport> {
	const root = resolve(inputRoot);
	const report: SurfaceCheckReport = { enrolled: 0, checked: 0, skipped: [], violations: [] };
	const candidates: SurfaceCandidate[] = [];
	const entries = new SpecIndex(root).contentEntries().sort((a, b) => a.path.localeCompare(b.path));

	for (const entry of entries) {
		const specFile = join(root, entry.path);
		const block = readSurfaceBlock(parseFile(entry.content).body);
		const barrel = barrelFor(specFile);
		const enrolled = list(entry.frontmatter, FIELDS.tags).includes(PUBLIC_SURFACE_TAG);
		if (!enrolled) {
			report.skipped.push({ path: entry.path, reason: skippedReason(block, barrel) });
			continue;
		}
		report.enrolled++;
		if (block === null) {
			report.violations.push(
				`${entry.path}: tagged ${PUBLIC_SURFACE_TAG} but declares no public surface`,
			);
			continue;
		}
		if (!isBareNameList(block)) {
			report.violations.push(
				`${entry.path}: tagged ${PUBLIC_SURFACE_TAG} but its public surface is not a bare identifier list`,
			);
			continue;
		}
		if (barrel === null) {
			report.violations.push(
				`${entry.path}: tagged ${PUBLIC_SURFACE_TAG} but has no TypeScript barrel`,
			);
			continue;
		}
		candidates.push({ specPath: entry.path, barrel, declared: declaredNames(block) });
	}

	const results = await readBarrelExports(
		root,
		candidates.map((candidate) => candidate.barrel),
	);
	for (const candidate of candidates) {
		const result = results.get(candidate.barrel);
		if (result === undefined) throw new Error(`no export result for ${candidate.barrel}`);
		if ("violations" in result) {
			for (const violation of result.violations) {
				report.violations.push(`${candidate.specPath}: ${violation}`);
			}
			continue;
		}
		report.checked++;
		const { promised, undeclared } = diffSurface(candidate.declared, result.names);
		if (promised.length > 0) {
			report.violations.push(
				`${candidate.specPath}: names its public surface promises but the barrel no longer exports: ${promised.join(", ")}`,
			);
		}
		if (undeclared.length > 0) {
			report.violations.push(
				`${candidate.specPath}: the barrel exports names its public surface does not list: ${undeclared.join(", ")}`,
			);
		}
	}
	report.skipped.sort((a, b) => a.path.localeCompare(b.path));
	report.violations.sort();
	return report;
}
