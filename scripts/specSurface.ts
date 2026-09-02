import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
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

interface CompilerConfiguration {
	key: string;
	options: ts.CompilerOptions;
	rootNames: string[];
	projectReferences?: readonly ts.ProjectReference[];
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
		return { key: "<default>", options: fallback, rootNames: [] };
	}
	const loaded = ts.readConfigFile(found, ts.sys.readFile);
	if (loaded.error !== undefined) {
		return { key: found, options: fallback, rootNames: [], error: diagnosticText(loaded.error) };
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
		rootNames: parsed.fileNames,
		...(parsed.projectReferences !== undefined
			? { projectReferences: parsed.projectReferences }
			: {}),
		...(errors.length > 0 ? { error: errors.map(diagnosticText).join("; ") } : {}),
	};
}

type ExportContainer = ts.SourceFile | ts.ModuleBlock;

function moduleContainers(symbol: ts.Symbol): ExportContainer[] {
	const containers: ExportContainer[] = [];
	for (const declaration of symbol.declarations ?? []) {
		if (ts.isSourceFile(declaration)) {
			containers.push(declaration);
			continue;
		}
		if (!ts.isModuleDeclaration(declaration)) continue;
		let body = declaration.body;
		while (body !== undefined && ts.isModuleDeclaration(body)) body = body.body;
		if (body !== undefined && ts.isModuleBlock(body)) containers.push(body);
	}
	return containers;
}

function bindingNames(name: ts.BindingName, names: Set<string>): void {
	if (ts.isIdentifier(name)) {
		names.add(name.text);
		return;
	}
	for (const element of name.elements) {
		if (!ts.isOmittedExpression(element)) bindingNames(element.name, names);
	}
}

function hasExportModifier(statement: ts.Statement): boolean {
	return (
		ts.canHaveModifiers(statement) &&
		(ts.getModifiers(statement) ?? []).some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		)
	);
}

function explicitExportNames(statements: readonly ts.Statement[]): Set<string> {
	const names = new Set<string>();
	for (const statement of statements) {
		if (ts.isExportAssignment(statement)) {
			names.add("default");
			continue;
		}
		if (ts.isExportDeclaration(statement)) {
			const clause = statement.exportClause;
			if (clause !== undefined) {
				if (ts.isNamespaceExport(clause)) names.add(clause.name.text);
				else for (const element of clause.elements) names.add(element.name.text);
			}
			continue;
		}
		if (!hasExportModifier(statement)) continue;
		const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
		if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
			names.add("default");
			continue;
		}
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				bindingNames(declaration.name, names);
			}
			continue;
		}
		if (ts.isImportEqualsDeclaration(statement)) {
			names.add(statement.name.text);
			continue;
		}
		if (
			ts.isFunctionDeclaration(statement) ||
			ts.isClassDeclaration(statement) ||
			ts.isEnumDeclaration(statement) ||
			ts.isModuleDeclaration(statement) ||
			ts.isTypeAliasDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement)
		) {
			if (statement.name !== undefined) names.add(statement.name.text);
		}
	}
	return names;
}

function resolvedAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
	return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function effectiveExportNames(
	sourceFile: ts.SourceFile,
	moduleSymbol: ts.Symbol,
	checker: ts.TypeChecker,
): string[] {
	if (
		sourceFile.statements.some(
			(statement) => ts.isExportAssignment(statement) && statement.isExportEquals,
		)
	) {
		return ["default"];
	}
	return checker
		.getExportsOfModule(moduleSymbol)
		.map((symbol) => symbol.getName())
		.sort();
}

type ExportStatement = ts.ExportDeclaration | ts.ExportAssignment;

function exportStatements(source: ts.SourceFile): ExportStatement[] {
	const statements: ExportStatement[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) statements.push(node);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return statements;
}

function exportGraphIssues(
	root: string,
	moduleSymbol: ts.Symbol,
	checker: ts.TypeChecker,
	program: ts.Program,
): string[] {
	const issues = new Set<string>();
	const seenSymbols = new Set<ts.Symbol>();
	const seenSources = new Map<string, ts.SourceFile>();
	const rootPrefix = `${resolve(root)}${sep}`;
	const shouldCheckDiagnostics = (source: ts.SourceFile): boolean => {
		const path = resolve(source.fileName);
		return path.startsWith(rootPrefix) && !path.includes(`${sep}node_modules${sep}`);
	};
	const visit = (symbol: ts.Symbol): void => {
		if (seenSymbols.has(symbol)) return;
		seenSymbols.add(symbol);
		const containers = moduleContainers(symbol);
		const statements = containers.flatMap((container) => [...container.statements]);
		if (statements.length === 0) return;
		for (const container of containers) {
			const source = container.getSourceFile();
			if (shouldCheckDiagnostics(source)) seenSources.set(source.fileName, source);
		}
		const firstSource = containers[0]?.getSourceFile();
		const modulePath =
			firstSource === undefined ? "unknown" : relativeTo(root, firstSource.fileName);
		for (const exported of checker.getExportsOfModule(symbol)) {
			if (!(exported.flags & ts.SymbolFlags.Alias)) continue;
			const target = resolvedAlias(exported, checker);
			if (target.name === "unknown" && target.declarations === undefined) {
				issues.add(`invalid exported alias in ${modulePath}: ${exported.getName()}`);
			} else {
				visit(target);
			}
		}
		const explicit = explicitExportNames(statements);
		const direct = explicitExportNames(
			statements.filter((statement) => !ts.isExportDeclaration(statement)),
		);
		const explicitClauses = new Set<string>();
		const starred = new Map<string, ts.Symbol>();
		for (const statement of statements) {
			if (!ts.isExportDeclaration(statement)) continue;
			const source = statement.getSourceFile();
			const sourcePath = relativeTo(root, source.fileName);
			if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
				for (const element of statement.exportClause.elements) {
					const name = element.name.text;
					if (direct.has(name) || explicitClauses.has(name)) {
						issues.add(`duplicate explicit export in ${sourcePath}: ${name}`);
					} else {
						explicitClauses.add(name);
					}
					const target = checker.getExportSpecifierLocalTargetSymbol(element);
					const resolved = target === undefined ? undefined : resolvedAlias(target, checker);
					if (
						resolved === undefined ||
						(resolved.name === "unknown" && resolved.declarations === undefined)
					) {
						issues.add(`invalid export specifier in ${sourcePath}: ${element.getText(source)}`);
					}
				}
			} else if (statement.exportClause !== undefined) {
				const name = statement.exportClause.name.text;
				if (direct.has(name) || explicitClauses.has(name)) {
					issues.add(`duplicate explicit export in ${sourcePath}: ${name}`);
				} else {
					explicitClauses.add(name);
				}
			}
			if (statement.moduleSpecifier === undefined) continue;
			const specifier = ts.isStringLiteralLike(statement.moduleSpecifier)
				? statement.moduleSpecifier.text
				: statement.moduleSpecifier.getText(source);
			const target = checker.getSymbolAtLocation(statement.moduleSpecifier);
			if (target === undefined) {
				issues.add(`re-export could not be resolved (${sourcePath} → ${specifier})`);
				continue;
			}
			if (statement.exportClause === undefined) {
				for (const exported of checker.getExportsOfModule(target)) {
					const name = exported.getName();
					if (name === "default" || explicit.has(name)) continue;
					const resolved = resolvedAlias(exported, checker);
					const prior = starred.get(name);
					if (prior !== undefined && prior !== resolved) {
						issues.add(`ambiguous star export in ${modulePath}: ${name}`);
					} else {
						starred.set(name, resolved);
					}
				}
			}
			visit(target);
		}
	};
	visit(moduleSymbol);
	for (const source of seenSources.values()) {
		const declarations = exportStatements(source);
		for (const diagnostic of program.getSemanticDiagnostics(source)) {
			if (diagnostic.start === undefined || diagnostic.code === 2307) continue;
			const declaration = declarations.find(
				(candidate) =>
					diagnostic.start !== undefined &&
					diagnostic.start >= candidate.getStart(source) &&
					diagnostic.start < candidate.end,
			);
			if (declaration !== undefined) {
				issues.add(
					`invalid re-export in ${relativeTo(root, source.fileName)} (TS${diagnostic.code}: ${diagnosticText(diagnostic)})`,
				);
			}
		}
	}
	return [...issues].sort();
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
		rootNames: [
			...new Set([...configuration.rootNames, ...candidates.map((candidate) => candidate.barrel)]),
		],
		options: configuration.options,
		...(configuration.projectReferences !== undefined
			? { projectReferences: configuration.projectReferences }
			: {}),
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
		const exportIssues = exportGraphIssues(root, moduleSymbol, checker, program);
		if (exportIssues.length > 0) {
			for (const issue of exportIssues) {
				report.violations.push(`${candidate.specPath}: ${issue}`);
			}
			continue;
		}
		const exported = effectiveExportNames(sourceFile, moduleSymbol, checker);
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
