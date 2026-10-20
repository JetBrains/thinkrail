import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { FIELDS, list, parseFile, SpecIndex } from "pi-spec-graph/core";
import {
	type BindingName,
	type ClassDeclaration,
	type EnumDeclaration,
	type ExportAssignment,
	type ExportDeclaration,
	type FunctionDeclaration,
	type ImportEqualsDeclaration,
	type InterfaceDeclaration,
	type ModuleBlock,
	type ModuleDeclaration,
	type Node,
	ScriptTarget,
	type SourceFile,
	type Statement,
	SyntaxKind,
	type TypeAliasDeclaration,
	type VariableStatement,
} from "tsrs/ast";
import {
	isClassDeclaration,
	isEnumDeclaration,
	isExportAssignment,
	isExportDeclaration,
	isFunctionDeclaration,
	isIdentifier,
	isImportEqualsDeclaration,
	isInterfaceDeclaration,
	isModuleBlock,
	isModuleDeclaration,
	isNamedExports,
	isNamespaceExport,
	isNoSubstitutionTemplateLiteral,
	isSourceFile,
	isStringLiteral,
	isTypeAliasDeclaration,
	isVariableStatement,
} from "tsrs/ast/is";
import {
	API,
	type Checker,
	type CompilerOptions,
	type Diagnostic,
	DiagnosticCategory,
	ModuleKind,
	ModuleResolutionKind,
	type Program,
	type ProjectReference,
	SymbolFlags,
	type Symbol as TsSymbol,
} from "tsrs/async";

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
	options: CompilerOptions;
	rootNames: string[];
	projectReferences?: ProjectReference[];
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

function findConfigFile(start: string): string | undefined {
	for (let directory = resolve(start); ; directory = dirname(directory)) {
		const candidate = join(directory, "tsconfig.json");
		if (fileExists(candidate)) return candidate;
		if (dirname(directory) === directory) return undefined;
	}
}

function diagnosticText(diagnostic: Diagnostic, indent = 0): string {
	const prefix = indent === 0 ? "" : `\n${"  ".repeat(indent)}`;
	const chain = (diagnostic.messageChain ?? []).map((next) => diagnosticText(next, indent + 1));
	return `${prefix}${diagnostic.text}${chain.join("")}`;
}

async function compilerConfiguration(
	api: API,
	barrel: string,
	root: string,
): Promise<CompilerConfiguration> {
	const fallback: CompilerOptions = {
		allowJs: true,
		allowImportingTsExtensions: true,
		module: ModuleKind.ESNext,
		moduleResolution: ModuleResolutionKind.Bundler,
		noEmit: true,
		skipLibCheck: true,
		target: ScriptTarget.ESNext,
	};
	const found = findConfigFile(dirname(barrel));
	const rootPrefix = `${resolve(root)}${sep}`;
	if (
		found === undefined ||
		(resolve(found) !== resolve(root) && !resolve(found).startsWith(rootPrefix))
	) {
		return { key: "<default>", options: fallback, rootNames: [] };
	}
	const loaded = await api.readConfigFile(found);
	if (loaded.error !== undefined) {
		return { key: found, options: fallback, rootNames: [], error: diagnosticText(loaded.error) };
	}
	const parsed = await api.parseJsonConfigFileContent(loaded.config, { configFileName: found });
	const errors = parsed.errors.filter(
		(diagnostic) => diagnostic.category === DiagnosticCategory.Error && diagnostic.code !== 18003,
	);
	return {
		key: found,
		options: { ...parsed.options, noEmit: true },
		rootNames: parsed.fileNames,
		...(parsed.projectReferences !== undefined
			? { projectReferences: parsed.projectReferences }
			: {}),
		...(errors.length > 0
			? { error: errors.map((error) => diagnosticText(error)).join("; ") }
			: {}),
	};
}

type ExportContainer = SourceFile | ModuleBlock;

async function moduleContainers(symbol: TsSymbol): Promise<ExportContainer[]> {
	const containers: ExportContainer[] = [];
	for (const handle of symbol.declarations) {
		const declaration = await handle.resolve();
		if (declaration === undefined) continue;
		if (isSourceFile(declaration)) {
			containers.push(declaration);
			continue;
		}
		if (!isModuleDeclaration(declaration)) continue;
		let body = declaration.body;
		while (body !== undefined && isModuleDeclaration(body)) body = body.body;
		if (body !== undefined && isModuleBlock(body)) containers.push(body);
	}
	return containers;
}

function bindingNames(name: BindingName, names: Set<string>): void {
	if (isIdentifier(name)) {
		names.add(name.text);
		return;
	}
	for (const element of name.elements) {
		if (element.name !== undefined) bindingNames(element.name, names);
	}
}

type ExportableStatement =
	| VariableStatement
	| ImportEqualsDeclaration
	| FunctionDeclaration
	| ClassDeclaration
	| EnumDeclaration
	| ModuleDeclaration
	| TypeAliasDeclaration
	| InterfaceDeclaration;

function isExportableStatement(statement: Statement): statement is ExportableStatement {
	return (
		isVariableStatement(statement) ||
		isImportEqualsDeclaration(statement) ||
		isFunctionDeclaration(statement) ||
		isClassDeclaration(statement) ||
		isEnumDeclaration(statement) ||
		isModuleDeclaration(statement) ||
		isTypeAliasDeclaration(statement) ||
		isInterfaceDeclaration(statement)
	);
}

function hasModifier(statement: ExportableStatement, kind: SyntaxKind): boolean {
	return (statement.modifiers ?? []).some((modifier) => modifier.kind === kind);
}

function explicitExportNames(statements: readonly Statement[]): Set<string> {
	const names = new Set<string>();
	for (const statement of statements) {
		if (isExportAssignment(statement)) {
			names.add("default");
			continue;
		}
		if (isExportDeclaration(statement)) {
			const clause = statement.exportClause;
			if (clause !== undefined) {
				if (isNamespaceExport(clause)) names.add(clause.name.text);
				else for (const element of clause.elements) names.add(element.name.text);
			}
			continue;
		}
		if (!isExportableStatement(statement) || !hasModifier(statement, SyntaxKind.ExportKeyword)) {
			continue;
		}
		if (hasModifier(statement, SyntaxKind.DefaultKeyword)) {
			names.add("default");
			continue;
		}
		if (isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				bindingNames(declaration.name, names);
			}
			continue;
		}
		if (statement.name !== undefined) names.add(statement.name.text);
	}
	return names;
}

async function resolvedAlias(symbol: TsSymbol, checker: Checker): Promise<TsSymbol> {
	return symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

async function effectiveExportNames(
	sourceFile: SourceFile,
	moduleSymbol: TsSymbol,
	checker: Checker,
): Promise<string[]> {
	if (
		sourceFile.statements.some(
			(statement) => isExportAssignment(statement) && statement.isExportEquals,
		)
	) {
		return ["default"];
	}
	return (await checker.getExportsOfModule(moduleSymbol)).map((symbol) => symbol.name).sort();
}

type ExportStatement = ExportDeclaration | ExportAssignment;

function exportStatements(source: SourceFile): ExportStatement[] {
	const statements: ExportStatement[] = [];
	const visit = (node: Node): void => {
		if (isExportDeclaration(node) || isExportAssignment(node)) statements.push(node);
		node.forEachChild(visit);
	};
	visit(source);
	return statements;
}

async function exportGraphIssues(
	root: string,
	moduleSymbol: TsSymbol,
	checker: Checker,
	program: Program,
): Promise<string[]> {
	const issues = new Set<string>();
	const seenSymbols = new Set<TsSymbol>();
	const seenSources = new Map<string, SourceFile>();
	const rootPrefix = `${resolve(root)}${sep}`;
	const shouldCheckDiagnostics = (source: SourceFile): boolean => {
		const path = resolve(source.fileName);
		return path.startsWith(rootPrefix) && !path.includes(`${sep}node_modules${sep}`);
	};
	const visit = async (symbol: TsSymbol): Promise<void> => {
		if (seenSymbols.has(symbol)) return;
		seenSymbols.add(symbol);
		const containers = await moduleContainers(symbol);
		const statements = containers.flatMap((container) => [...container.statements]);
		if (statements.length === 0) return;
		for (const container of containers) {
			const source = container.getSourceFile();
			if (shouldCheckDiagnostics(source)) seenSources.set(source.fileName, source);
		}
		const firstSource = containers[0]?.getSourceFile();
		const modulePath =
			firstSource === undefined ? "unknown" : relativeTo(root, firstSource.fileName);
		for (const exported of await checker.getExportsOfModule(symbol)) {
			if (!(exported.flags & SymbolFlags.Alias)) continue;
			const target = await resolvedAlias(exported, checker);
			if (await checker.isUnknownSymbol(target)) {
				issues.add(`invalid exported alias in ${modulePath}: ${exported.name}`);
			} else {
				await visit(target);
			}
		}
		const explicit = explicitExportNames(statements);
		const direct = explicitExportNames(
			statements.filter((statement) => !isExportDeclaration(statement)),
		);
		const explicitClauses = new Set<string>();
		const starred = new Map<string, TsSymbol>();
		for (const statement of statements) {
			if (!isExportDeclaration(statement)) continue;
			const source = statement.getSourceFile();
			const sourcePath = relativeTo(root, source.fileName);
			if (statement.exportClause !== undefined && isNamedExports(statement.exportClause)) {
				for (const element of statement.exportClause.elements) {
					const name = element.name.text;
					if (direct.has(name) || explicitClauses.has(name)) {
						issues.add(`duplicate explicit export in ${sourcePath}: ${name}`);
					} else {
						explicitClauses.add(name);
					}
					const target = await checker.getExportSpecifierLocalTargetSymbol(element);
					const resolved = target === undefined ? undefined : await resolvedAlias(target, checker);
					if (resolved === undefined || (await checker.isUnknownSymbol(resolved))) {
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
			const moduleSpecifier = statement.moduleSpecifier;
			if (moduleSpecifier === undefined) continue;
			const specifier =
				isStringLiteral(moduleSpecifier) || isNoSubstitutionTemplateLiteral(moduleSpecifier)
					? moduleSpecifier.text
					: moduleSpecifier.getText(source);
			const target = await checker.getSymbolAtLocation(moduleSpecifier);
			if (target === undefined) {
				issues.add(`re-export could not be resolved (${sourcePath} → ${specifier})`);
				continue;
			}
			if (statement.exportClause === undefined) {
				for (const exported of await checker.getExportsOfModule(target)) {
					const name = exported.name;
					if (name === "default" || explicit.has(name)) continue;
					const resolved = await resolvedAlias(exported, checker);
					const prior = starred.get(name);
					if (prior !== undefined && prior !== resolved) {
						issues.add(`ambiguous star export in ${modulePath}: ${name}`);
					} else {
						starred.set(name, resolved);
					}
				}
			}
			await visit(target);
		}
	};
	await visit(moduleSymbol);
	for (const source of seenSources.values()) {
		const declarations = exportStatements(source);
		for (const diagnostic of await program.getSemanticDiagnostics(source.fileName)) {
			if (diagnostic.fileName === undefined || diagnostic.code === 2307) continue;
			const declaration = declarations.find(
				(candidate) =>
					diagnostic.pos >= candidate.getStart(source) && diagnostic.pos < candidate.end,
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

async function checkCompilerGroup(
	api: API,
	root: string,
	configuration: CompilerConfiguration,
	candidates: SurfaceCandidate[],
	report: SurfaceCheckReport,
): Promise<void> {
	if (configuration.error !== undefined) {
		for (const candidate of candidates) {
			report.violations.push(
				`${candidate.specPath}: TypeScript configuration could not be loaded (${configuration.error})`,
			);
		}
		return;
	}
	const program = await api.createProgram(
		[...new Set([...configuration.rootNames, ...candidates.map((candidate) => candidate.barrel)])],
		configuration.options,
		configuration.projectReferences !== undefined
			? { projectReferences: configuration.projectReferences }
			: undefined,
	);
	const checker = program.getProject().checker;
	for (const candidate of candidates) {
		const sourceFile = await program.getSourceFile(candidate.barrel);
		if (sourceFile === undefined) {
			report.violations.push(`${candidate.specPath}: barrel could not be loaded by TypeScript`);
			continue;
		}
		const moduleSymbol = await checker.getSymbolAtLocation(sourceFile);
		if (moduleSymbol === undefined) {
			report.violations.push(`${candidate.specPath}: barrel is not a TypeScript module`);
			continue;
		}
		const exportIssues = await exportGraphIssues(root, moduleSymbol, checker, program);
		if (exportIssues.length > 0) {
			for (const issue of exportIssues) {
				report.violations.push(`${candidate.specPath}: ${issue}`);
			}
			continue;
		}
		const exported = await effectiveExportNames(sourceFile, moduleSymbol, checker);
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

	if (candidates.length > 0) {
		const api = new API({ cwd: root });
		try {
			const groups = new Map<
				string,
				{ configuration: CompilerConfiguration; candidates: SurfaceCandidate[] }
			>();
			for (const candidate of candidates) {
				const configuration = await compilerConfiguration(api, candidate.barrel, root);
				const group = groups.get(configuration.key);
				if (group === undefined) {
					groups.set(configuration.key, { configuration, candidates: [candidate] });
				} else {
					group.candidates.push(candidate);
				}
			}
			for (const group of groups.values()) {
				await checkCompilerGroup(api, root, group.configuration, group.candidates, report);
			}
		} finally {
			await api.close();
		}
	}
	report.skipped.sort((a, b) => a.path.localeCompare(b.path));
	report.violations.sort();
	return report;
}
