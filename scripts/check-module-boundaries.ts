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
	{
		root: "packages/artifact-tests",
		allowed: ["apps/cli", "packages/server", "packages/shared"],
	},
	{ root: "packages/contracts", allowed: [] },
	{ root: "packages/shared", allowed: ["packages/contracts"] },
	{ root: "packages/pi-delegation", allowed: [] },
	{ root: "packages/pi-background-commands", allowed: [] },
	{ root: "packages/pi-subagents", allowed: ["packages/pi-delegation"] },
	{ root: "packages/pi-dag", allowed: ["packages/pi-delegation"] },
	{
		root: "packages/server",
		allowed: [
			"packages/contracts",
			"packages/shared",
			"packages/spec-graph",
			"packages/pi-delegation",
			"packages/pi-background-commands",
			"packages/pi-subagents",
			"packages/pi-thinkrail-workflow",
			"packages/pi-todos",
			"packages/pi-visualize",
			"packages/extension-api",
		],
	},
	{
		root: "apps/web",
		allowed: ["packages/contracts", "packages/ui", "packages/extension-api"],
	},
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
	".hutch",
	".cottontail-tmp",
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
	for (const base of ["apps", "packages", "pi-extensions", "thinkrail-extensions"]) {
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

function moduleRules(packages: ReadonlyMap<string, string>): ModuleRule[] {
	const roots = [...packages.values()];
	const extensions = roots.filter((root) => root.startsWith("thinkrail-extensions/"));
	return [
		...MODULE_RULES.map((rule) =>
			rule.root === "apps/web" || rule.root === "packages/server"
				? { ...rule, allowed: [...rule.allowed, ...extensions] }
				: rule,
		),
		...roots
			.filter((root) => root === "packages/ui" || root === "packages/extension-api")
			.map((root) => ({ root, allowed: ["packages/contracts"] })),
		...roots
			.filter((root) => root.startsWith("pi-extensions/"))
			.map((root) => ({ root, allowed: [] })),
		...extensions.map((root) => ({
			root,
			allowed: [
				"packages/contracts",
				"packages/ui",
				"packages/extension-api",
				piExtensionRoot(root),
			],
		})),
	];
}

function piExtensionRoot(extensionRoot: string): string {
	return extensionRoot.replace(/^thinkrail-extensions\//, "pi-extensions/");
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

interface SourceImport {
	specifier: string;
	typeOnly: boolean;
}

function importSpecifiers(path: string): SourceImport[] {
	const source = ts.createSourceFile(
		path,
		readFileSync(path, "utf8"),
		ts.ScriptTarget.Latest,
		false,
		path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const specifiers: SourceImport[] = [];
	const add = (node: ts.Expression | undefined, typeOnly = false): void => {
		if (node && ts.isStringLiteralLike(node)) specifiers.push({ specifier: node.text, typeOnly });
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node)) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			const typeOnly =
				clause?.isTypeOnly ||
				(!clause?.name &&
					bindings &&
					ts.isNamedImports(bindings) &&
					bindings.elements.length > 0 &&
					bindings.elements.every((element) => element.isTypeOnly));
			add(node.moduleSpecifier, !!typeOnly);
		} else if (ts.isExportDeclaration(node)) {
			const clause = node.exportClause;
			const typeOnly =
				node.isTypeOnly ||
				(clause &&
					ts.isNamedExports(clause) &&
					clause.elements.length > 0 &&
					clause.elements.every((element) => element.isTypeOnly));
			add(node.moduleSpecifier, !!typeOnly);
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference)
		) {
			add(node.moduleReference.expression, node.isTypeOnly);
		} else if (ts.isCallExpression(node)) {
			if (
				node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === "require")
			) {
				add(node.arguments[0]);
			}
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			add(node.argument.literal, true);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return specifiers;
}

interface WorkspaceTarget {
	root: string;
	name: string;
	subpath: string;
}

function workspaceTarget(
	specifier: string,
	fromFile: string,
	root: string,
	packages: ReadonlyMap<string, string>,
): WorkspaceTarget | undefined {
	if (specifier.startsWith(".")) {
		const target = resolve(dirname(fromFile), specifier);
		for (const [name, moduleRoot] of packages) {
			const modulePath = join(root, moduleRoot);
			if (target === modulePath || target.startsWith(`${modulePath}${sep}`)) {
				return { root: moduleRoot, name, subpath: normalized(relative(modulePath, target)) };
			}
		}
		return undefined;
	}
	for (const [name, moduleRoot] of packages) {
		if (specifier === name || specifier.startsWith(`${name}/`)) {
			const modulePath = join(root, moduleRoot);
			const target = resolve(modulePath, specifier.slice(name.length + 1));
			return { root: moduleRoot, name, subpath: normalized(relative(modulePath, target)) };
		}
	}
	return undefined;
}

function allowedEdge(rule: ModuleRule, target: string): boolean {
	return target === rule.root || rule.allowed.includes(target);
}

// Public entry names and source files/directories share the same half identity.
// The SDK uses src/web.ts + src/server.ts; extensions use web/** + server/**.
function sourceHalf(subpath: string): "web" | "server" | undefined {
	const match = /^(web|server)(?:\/|$|\.[cm]?[jt]sx?$)/.exec(subpath);
	return match?.[1] as "web" | "server" | undefined;
}

function sourceRule(rule: ModuleRule, subpath: string): ModuleRule {
	if (!rule.root.startsWith("thinkrail-extensions/")) return rule;
	switch (sourceHalf(subpath)) {
		case "web":
			return { ...rule, allowed: ["packages/contracts", "packages/ui", "packages/extension-api"] };
		case "server":
			return { ...rule, allowed: ["packages/extension-api", piExtensionRoot(rule.root)] };
		default:
			return rule;
	}
}

function sourceViolation(
	rule: ModuleRule,
	subpath: string,
	{ specifier, typeOnly }: SourceImport,
	target: WorkspaceTarget | undefined,
): string | undefined {
	if (target && !allowedEdge(sourceRule(rule, subpath), target.root)) {
		return `creates forbidden ${rule.root} -> ${target.root} edge`;
	}
	const extension = rule.root.startsWith("thinkrail-extensions/");
	const half = sourceHalf(subpath);
	const sdk = rule.root === "packages/extension-api";
	const sdkHalf = sourceHalf(subpath.replace(/^src\//, ""));
	if (target) {
		if (extension && target.root === rule.root && half) {
			const targetHalf = sourceHalf(target.subpath);
			if (targetHalf && targetHalf !== half) return "crosses extension web/server source halves";
		}
		if (
			sdk &&
			sdkHalf !== "server" &&
			target.root === rule.root &&
			sourceHalf(target.subpath.replace(/^src\//, "")) === "server"
		) {
			return "leaks extension-api's server half into browser sources";
		}
		let publicEntry: "web" | "server" | undefined;
		if (target.root.startsWith("thinkrail-extensions/")) {
			if (rule.root === "apps/web") publicEntry = "web";
			if (rule.root === "packages/server") publicEntry = "server";
		} else if (target.root === "packages/extension-api" && !sdk) {
			if (rule.root === "apps/web" || (extension && half === "web")) publicEntry = "web";
			if (rule.root === "packages/server" || (extension && half === "server"))
				publicEntry = "server";
		}
		if (publicEntry && specifier !== `${target.name}/${publicEntry}`) {
			return `may use only public ${target.name}/${publicEntry}`;
		}
	}
	const browserSafe =
		rule.root === "apps/web" ||
		rule.root === "packages/ui" ||
		rule.root === "packages/contracts" ||
		sdk ||
		(extension && half === "web");
	const piPackage =
		target?.root.startsWith("pi-extensions/") ||
		/^(?:@[^/]+\/)?pi-[^/]+(?:\/|$)/.test(target?.name ?? specifier);
	if (browserSafe && !typeOnly && piPackage)
		return "creates forbidden pi value import in browser-safe sources";
	return undefined;
}

export function moduleBoundaryViolations(root: string): string[] {
	const absoluteRoot = resolve(root);
	const packages = workspacePackages(absoluteRoot);
	const violations: string[] = [];
	for (const rule of moduleRules(packages)) {
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
			for (const sourceImport of importSpecifiers(path)) {
				const target = workspaceTarget(sourceImport.specifier, path, absoluteRoot, packages);
				const violation = sourceViolation(
					rule,
					normalized(relative(modulePath, path)),
					sourceImport,
					target,
				);
				if (violation) {
					violations.push(
						`${normalized(relative(absoluteRoot, path))}: import ${JSON.stringify(sourceImport.specifier)} ${violation}`,
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
	console.log(
		`check-module-boundaries: OK (${moduleRules(workspacePackages(root)).length} module boundaries enforced)`,
	);
}
