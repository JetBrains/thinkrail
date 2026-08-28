#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

interface Manifest {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

interface ModuleRule {
	root: string;
	allowed: readonly string[];
}

const MODULE_RULES: readonly ModuleRule[] = [
	{ root: "packages/contracts", allowed: [] },
	{ root: "packages/shared", allowed: ["packages/contracts"] },
	{ root: "packages/pi-delegation", allowed: [] },
	{ root: "packages/pi-subagents", allowed: ["packages/pi-delegation"] },
	{
		root: "packages/server",
		allowed: [
			"packages/contracts",
			"packages/shared",
			"packages/spec-graph",
			"packages/pi-delegation",
			"packages/pi-subagents",
			"packages/pi-thinkrail-workflow",
			"packages/pi-todos",
			"packages/pi-visualize",
		],
	},
	{ root: "apps/web", allowed: ["packages/contracts"] },
	{ root: "apps/cli", allowed: ["packages/server", "packages/shared"] },
	{
		root: "apps/desktop",
		allowed: ["packages/server", "packages/shared", "packages/contracts"],
	},
];

const DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRECTORIES = new Set([
	".git",
	".stage",
	"artifacts",
	"build",
	"dist",
	"node_modules",
]);

function normalized(path: string): string {
	return path.split(sep).join("/");
}

function workspacePackages(root: string): Map<string, string> {
	const packages = new Map<string, string>();
	for (const base of ["apps", "packages"]) {
		const basePath = join(root, base);
		if (!existsSync(basePath)) continue;
		for (const entry of readdirSync(basePath, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const moduleRoot = `${base}/${entry.name}`;
			const manifestPath = join(root, moduleRoot, "package.json");
			if (!existsSync(manifestPath)) continue;
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
			if (manifest.name) packages.set(manifest.name, moduleRoot);
		}
	}
	return packages;
}

function sourceFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (path: string): void => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
			const child = join(path, entry.name);
			if (entry.isDirectory()) visit(child);
			else if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf("."))))
				files.push(child);
		}
	};
	visit(root);
	return files;
}

function importSpecifiers(path: string): string[] {
	const source = ts.createSourceFile(
		path,
		readFileSync(path, "utf8"),
		ts.ScriptTarget.Latest,
		false,
		path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const specifiers: string[] = [];
	const add = (node: ts.Expression | undefined): void => {
		if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			add(node.moduleSpecifier);
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference)
		) {
			add(node.moduleReference.expression);
		} else if (ts.isCallExpression(node)) {
			if (
				node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === "require")
			) {
				add(node.arguments[0]);
			}
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			add(node.argument.literal);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return specifiers;
}

function workspaceTarget(
	specifier: string,
	fromFile: string,
	root: string,
	packages: ReadonlyMap<string, string>,
): string | undefined {
	if (specifier.startsWith(".")) {
		const target = resolve(dirname(fromFile), specifier);
		for (const moduleRoot of packages.values()) {
			const modulePath = join(root, moduleRoot);
			if (target === modulePath || target.startsWith(`${modulePath}${sep}`)) return moduleRoot;
		}
		return undefined;
	}
	for (const [name, moduleRoot] of packages) {
		if (specifier === name || specifier.startsWith(`${name}/`)) return moduleRoot;
	}
	return undefined;
}

function allowedEdge(rule: ModuleRule, target: string): boolean {
	return target === rule.root || rule.allowed.includes(target);
}

export function moduleBoundaryViolations(root: string): string[] {
	const absoluteRoot = resolve(root);
	const packages = workspacePackages(absoluteRoot);
	const violations: string[] = [];
	for (const rule of MODULE_RULES) {
		const modulePath = join(absoluteRoot, rule.root);
		const manifestPath = join(modulePath, "package.json");
		if (!existsSync(manifestPath)) {
			violations.push(`${rule.root}/package.json is missing`);
			continue;
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
		for (const section of DEPENDENCY_SECTIONS) {
			for (const dependency of Object.keys(manifest[section] ?? {})) {
				const target = packages.get(dependency);
				if (target && !allowedEdge(rule, target)) {
					violations.push(
						`${rule.root}/package.json: ${section}.${dependency} creates forbidden ${rule.root} -> ${target} edge`,
					);
				}
			}
		}
		for (const path of sourceFiles(modulePath)) {
			for (const specifier of importSpecifiers(path)) {
				const target = workspaceTarget(specifier, path, absoluteRoot, packages);
				if (target && !allowedEdge(rule, target)) {
					violations.push(
						`${normalized(relative(absoluteRoot, path))}: import ${JSON.stringify(specifier)} creates forbidden ${rule.root} -> ${target} edge`,
					);
				}
			}
		}
	}
	return violations.sort();
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const violations = moduleBoundaryViolations(root);
	if (violations.length > 0) {
		console.error("Module boundary violations:");
		for (const violation of violations) console.error(`  - ${violation}`);
		process.exit(1);
	}
	console.log(`check-module-boundaries: OK (${MODULE_RULES.length} module boundaries enforced)`);
}
