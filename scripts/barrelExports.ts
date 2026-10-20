import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

export type BarrelExports = { names: string[] } | { violations: string[] };

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

export function fileExists(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
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

async function groupExports(
	api: API,
	root: string,
	configuration: CompilerConfiguration,
	barrels: readonly string[],
	results: Map<string, BarrelExports>,
): Promise<void> {
	if (configuration.error !== undefined) {
		for (const barrel of barrels) {
			results.set(barrel, {
				violations: [`TypeScript configuration could not be loaded (${configuration.error})`],
			});
		}
		return;
	}
	const program = await api.createProgram(
		[...new Set([...configuration.rootNames, ...barrels])],
		configuration.options,
		configuration.projectReferences !== undefined
			? { projectReferences: configuration.projectReferences }
			: undefined,
	);
	const checker = program.getProject().checker;
	for (const barrel of barrels) {
		const sourceFile = await program.getSourceFile(barrel);
		if (sourceFile === undefined) {
			results.set(barrel, { violations: ["barrel could not be loaded by TypeScript"] });
			continue;
		}
		const moduleSymbol = await checker.getSymbolAtLocation(sourceFile);
		if (moduleSymbol === undefined) {
			results.set(barrel, { violations: ["barrel is not a TypeScript module"] });
			continue;
		}
		const issues = await exportGraphIssues(root, moduleSymbol, checker, program);
		results.set(
			barrel,
			issues.length > 0
				? { violations: issues }
				: { names: await effectiveExportNames(sourceFile, moduleSymbol, checker) },
		);
	}
}

export async function readBarrelExports(
	root: string,
	barrels: readonly string[],
): Promise<Map<string, BarrelExports>> {
	const results = new Map<string, BarrelExports>();
	if (barrels.length === 0) return results;
	const api = new API({ cwd: root });
	try {
		const groups = new Map<string, { configuration: CompilerConfiguration; barrels: string[] }>();
		for (const barrel of new Set(barrels)) {
			const configuration = await compilerConfiguration(api, barrel, root);
			const group = groups.get(configuration.key);
			if (group === undefined) groups.set(configuration.key, { configuration, barrels: [barrel] });
			else group.barrels.push(barrel);
		}
		for (const group of groups.values()) {
			await groupExports(api, root, group.configuration, group.barrels, results);
		}
	} finally {
		await api.close();
	}
	return results;
}
