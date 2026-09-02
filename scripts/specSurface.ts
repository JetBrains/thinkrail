import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { FIELDS, list, parseFile, SpecIndex } from "pi-spec-graph/core";
import ts from "typescript";

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

function visibleMarkdown(text: string): string {
	let fence: { marker: string; length: number } | null = null;
	return text
		.split("\n")
		.map((line) => {
			const opening = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
			if (fence !== null) {
				if (
					opening !== undefined &&
					opening[0] === fence.marker &&
					opening.length >= fence.length
				) {
					fence = null;
				}
				return "";
			}
			if (opening !== undefined) {
				fence = { marker: opening[0] ?? "", length: opening.length };
				return "";
			}
			return /^(?: {4}|\t)/.test(line) ? "" : line;
		})
		.join("\n");
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
	const lines = visibleMarkdown(specText).split("\n");
	const labelled = lines.findIndex(declaredByLabel);
	const start = labelled === -1 ? lines.findIndex(declaredInProse) : labelled;
	const first = lines[start];
	if (start === -1 || first === undefined) return null;
	const heading = HEADING.test(first);
	const collected = [first];
	let blanks = 0;
	for (let index = start + 1; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (HEADING.test(line)) break;
		if (!heading && TOP_LEVEL_BULLET.test(line)) break;
		if (line.trim() === "") {
			blanks++;
			if (!heading || blanks >= 2) break;
			continue;
		}
		blanks = 0;
		collected.push(line);
	}
	return { text: collected.join("\n"), heading };
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

interface CompilerConfiguration {
	key: string;
	options: ts.CompilerOptions;
	error?: string;
}

function normalized(path: string): string {
	return path.split(sep).join("/");
}

function relativeTo(root: string, path: string): string {
	return normalized(relative(root, path));
}

function fileExists(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
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

function diagnosticText(diagnostic: ts.Diagnostic): string {
	return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function compilerConfiguration(barrel: string, root: string): CompilerConfiguration {
	const fallback: ts.CompilerOptions = {
		allowJs: true,
		allowImportingTsExtensions: true,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ESNext,
	};
	const found = ts.findConfigFile(dirname(barrel), ts.sys.fileExists);
	const rootPrefix = `${resolve(root)}${sep}`;
	if (
		found === undefined ||
		(resolve(found) !== resolve(root) && !resolve(found).startsWith(rootPrefix))
	) {
		return { key: "<default>", options: fallback };
	}
	const loaded = ts.readConfigFile(found, ts.sys.readFile);
	if (loaded.error !== undefined) {
		return { key: found, options: fallback, error: diagnosticText(loaded.error) };
	}
	const parsed = ts.parseJsonConfigFileContent(
		loaded.config,
		ts.sys,
		dirname(found),
		{
			noEmit: true,
		},
		found,
	);
	const errors = parsed.errors.filter(
		(diagnostic) =>
			diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code !== 18003,
	);
	return {
		key: found,
		options: parsed.options,
		...(errors.length > 0 ? { error: errors.map(diagnosticText).join("; ") } : {}),
	};
}

function sourceFileFor(symbol: ts.Symbol): ts.SourceFile | undefined {
	return symbol.declarations?.find(ts.isSourceFile);
}

function unresolvedReexports(
	root: string,
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
): string[] {
	const unresolved: string[] = [];
	const seen = new Set<string>();
	const visit = (source: ts.SourceFile): void => {
		if (seen.has(source.fileName)) return;
		seen.add(source.fileName);
		for (const statement of source.statements) {
			if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue;
			const specifier = ts.isStringLiteralLike(statement.moduleSpecifier)
				? statement.moduleSpecifier.text
				: statement.moduleSpecifier.getText(source);
			const target = checker.getSymbolAtLocation(statement.moduleSpecifier);
			if (target === undefined) {
				unresolved.push(`${relativeTo(root, source.fileName)} → ${specifier}`);
				continue;
			}
			if (statement.exportClause === undefined) {
				const targetSource = sourceFileFor(target);
				if (targetSource !== undefined) visit(targetSource);
			}
		}
	};
	visit(sourceFile);
	return unresolved.sort();
}

function checkCompilerGroup(
	root: string,
	configuration: CompilerConfiguration,
	candidates: SurfaceCandidate[],
	report: SurfaceCheckReport,
): void {
	if (configuration.error !== undefined) {
		for (const candidate of candidates) {
			report.violations.push(
				`${candidate.specPath}: TypeScript configuration could not be loaded (${configuration.error})`,
			);
		}
		return;
	}
	const program = ts.createProgram({
		rootNames: candidates.map((candidate) => candidate.barrel),
		options: configuration.options,
	});
	const checker = program.getTypeChecker();
	for (const candidate of candidates) {
		const sourceFile = program.getSourceFile(candidate.barrel);
		if (sourceFile === undefined) {
			report.violations.push(`${candidate.specPath}: barrel could not be loaded by TypeScript`);
			continue;
		}
		const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
		if (moduleSymbol === undefined) {
			report.violations.push(`${candidate.specPath}: barrel is not a TypeScript module`);
			continue;
		}
		const unresolved = unresolvedReexports(root, sourceFile, checker);
		if (unresolved.length > 0) {
			for (const edge of unresolved) {
				report.violations.push(`${candidate.specPath}: re-export could not be resolved (${edge})`);
			}
			continue;
		}
		const exported = checker
			.getExportsOfModule(moduleSymbol)
			.map((symbol) => symbol.getName())
			.sort();
		report.checked++;
		const { promised, undeclared } = diffSurface(candidate.declared, exported);
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
}

function skippedReason(block: SurfaceBlock | null, barrel: string | null): string {
	if (block === null) return "not enrolled; no public surface";
	if (!isBareNameList(block)) return "not enrolled; surface written as prose";
	if (barrel === null) return "not enrolled; no barrel to compare against";
	return "not enrolled";
}

export function checkSpecSurfaces(inputRoot: string): SurfaceCheckReport {
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

	const groups = new Map<
		string,
		{ configuration: CompilerConfiguration; candidates: SurfaceCandidate[] }
	>();
	for (const candidate of candidates) {
		const configuration = compilerConfiguration(candidate.barrel, root);
		const group = groups.get(configuration.key);
		if (group === undefined) {
			groups.set(configuration.key, { configuration, candidates: [candidate] });
		} else {
			group.candidates.push(candidate);
		}
	}
	for (const group of groups.values()) {
		checkCompilerGroup(root, group.configuration, group.candidates, report);
	}
	report.skipped.sort((a, b) => a.path.localeCompare(b.path));
	report.violations.sort();
	return report;
}
