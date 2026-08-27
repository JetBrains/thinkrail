import ts from "typescript";

const SURFACE = /Public surface/i;
const SURFACE_OPENS = /^Public surface/i;
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

function declaredByLabel(line: string): boolean {
	if (HEADING.test(line)) return SURFACE.test(line);
	const label = BULLET_LABEL.exec(line);
	return label?.[1] !== undefined && SURFACE.test(label[1]);
}

function declaredInProse(line: string): boolean {
	return !HEADING.test(line) && !BULLET.test(line) && SURFACE_OPENS.test(line.trimStart());
}

export function readSurfaceBlock(specText: string): SurfaceBlock | null {
	const lines = specText.split("\n");
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
	return [...names];
}

export interface ParsedExports {
	names: string[];
	starTargets: string[];
}

function declaredNamesOf(statement: ts.Statement): string[] {
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap((declaration) =>
			ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
		);
	}
	if (
		ts.isFunctionDeclaration(statement) ||
		ts.isClassDeclaration(statement) ||
		ts.isEnumDeclaration(statement) ||
		ts.isModuleDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isInterfaceDeclaration(statement)
	) {
		const name = statement.name;
		return name !== undefined && ts.isIdentifier(name) ? [name.text] : [];
	}
	return [];
}

function isExported(statement: ts.Statement): boolean {
	if (!ts.canHaveModifiers(statement)) return false;
	const modifiers = ts.getModifiers(statement) ?? [];
	if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return false;
	return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

export function parseExports(source: string): ParsedExports {
	const names = new Set<string>();
	const starTargets: string[] = [];
	const tree = ts.createSourceFile("barrel.ts", source, ts.ScriptTarget.Latest, false);

	for (const statement of tree.statements) {
		if (ts.isExportDeclaration(statement)) {
			const clause = statement.exportClause;
			if (clause === undefined) {
				const target = statement.moduleSpecifier;
				if (target !== undefined && ts.isStringLiteral(target)) starTargets.push(target.text);
			} else if (ts.isNamespaceExport(clause)) {
				names.add(clause.name.text);
			} else {
				for (const element of clause.elements) names.add(element.name.text);
			}
			continue;
		}
		if (isExported(statement)) for (const name of declaredNamesOf(statement)) names.add(name);
	}

	return { names: [...names], starTargets };
}

export interface SurfaceDiff {
	promised: string[];
	undeclared: string[];
}

export function diffSurface(declared: string[], exported: string[]): SurfaceDiff {
	const exportedSet = new Set(exported);
	const declaredSet = new Set(declared);
	return {
		promised: declared.filter((name) => !exportedSet.has(name)),
		undeclared: exported.filter((name) => !declaredSet.has(name)),
	};
}
