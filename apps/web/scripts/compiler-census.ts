#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
	type ArrowFunctionExpression,
	type CallExpression,
	type Function as FunctionLike,
	type Node,
	type Program,
	parseSync,
	visitorKeys,
} from "oxc-parser";
import { type OxcError, type ReactCompilerOptions, transformSync } from "oxc-transform-react";
import { designSourceFiles } from "./designSources";
import { type GeneratedFile, normalizeEol, writeOrCheck } from "./generatedFiles";

// Must match the `react({ compiler })` options in vite.config.ts.
const COMPILER_OPTIONS: ReactCompilerOptions = {};
const CODE_FILTER = /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/;
const UNIT_NAME = /^(?:[A-Z]|use[A-Z0-9])/;
const HOOK_NAME = /^use[A-Z0-9]/;
const UNIT_WRAPPERS = new Set(["memo", "forwardRef"]);
const MEMO_CACHE = /\b_c\d*\(\d+\)/g;
const OPT_IN_DIRECTIVES = ["use memo", "use forget"];
// The compiler skips a unit under one of these directives without a diagnostic.
const OPT_OUT_DIRECTIVES = COMPILER_OPTIONS.ignoreUseNoForget
	? []
	: (COMPILER_OPTIONS.customOptOutDirectives ?? ["use no memo", "use no forget"]);

// TypeScript-only syntax the compiler looks through, as in `memo((props: P) => …) as FC`.
const TYPE_WRAPPERS = new Set([
	"TSAsExpression",
	"TSSatisfiesExpression",
	"TSNonNullExpression",
	"TSTypeAssertion",
]);
// A component that returns one of these cannot be rendering, so the compiler leaves it alone.
const NON_NODE_RETURNS = new Set([
	"ObjectExpression",
	"ArrowFunctionExpression",
	"FunctionExpression",
	"ClassExpression",
	"NewExpression",
]);

const WEB_ROOT = resolve(import.meta.dir, "..");
const BASELINE = resolve(import.meta.dir, "compiler-census.baseline.txt");
const EXCLUDED = /\.(test|spec|stories)\.[tj]sx?$/;

interface Bailout {
	file: string;
	line: number;
	fnLine: number;
	fnName: string;
	reason: string;
	description: string | null;
	category: string;
}

interface FileResult {
	memoized: number;
	bailouts: Bailout[];
}

interface Unit {
	start: number;
	end: number;
	name: string;
	optOut: OptOut | null;
}

interface OptOut {
	directive: string;
	start: number;
}

type FunctionNode = (FunctionLike | ArrowFunctionExpression) & {
	body: NonNullable<(FunctionLike | ArrowFunctionExpression)["body"]>;
};

function isNode(value: unknown): value is Node {
	return typeof value === "object" && value !== null && "type" in value;
}

function children(node: Node) {
	return (visitorKeys[node.type] ?? []).flatMap((key) => {
		const value: unknown = Reflect.get(node, key);
		return (Array.isArray(value) ? value : [value]).filter(isNode);
	});
}

function isFunction(node: Node): node is FunctionNode {
	return (
		(node.type === "FunctionDeclaration" ||
			node.type === "FunctionExpression" ||
			node.type === "ArrowFunctionExpression") &&
		node.body !== null
	);
}

function isClass(node: Node) {
	return node.type === "ClassDeclaration" || node.type === "ClassExpression";
}

/** The node `node` hangs from, skipping TypeScript-only wrappers; `child` is the wrapper (or `node`). */
function parentOf(node: Node, ancestors: Node[]) {
	let child = node;
	let index = ancestors.length - 1;
	while (index >= 0 && TYPE_WRAPPERS.has(ancestors[index]?.type ?? "")) {
		child = ancestors[index] as Node;
		index--;
	}
	return { parent: ancestors[index], child, above: ancestors.slice(0, Math.max(index, 0)) };
}

function isWrappedArgument(parent: Node | undefined, child: Node): parent is CallExpression {
	return parent?.type === "CallExpression" && parent.callee !== child;
}

function bindingName(node: Node, ancestors: Node[]): string | null {
	const { parent, child, above } = parentOf(node, ancestors);
	if (!parent) return null;
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
		return parent.id.name;
	if (
		parent.type === "Property" &&
		parent.kind === "init" &&
		!parent.method &&
		!parent.computed &&
		parent.key.type === "Identifier"
	) {
		return parent.key.name;
	}
	if (parent.type === "ExportDefaultDeclaration") return "default";
	if (isWrappedArgument(parent, child)) return bindingName(parent, above);
	return null;
}

function calleeName(node: Node) {
	if (node.type === "Identifier") return node.name;
	if (
		node.type === "MemberExpression" &&
		!node.computed &&
		node.object.type === "Identifier" &&
		node.object.name === "React" &&
		node.property.type === "Identifier"
	) {
		return node.property.name;
	}
	return null;
}

function ownName(node: FunctionNode, ancestors: Node[]) {
	if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
	const binding = bindingName(node, ancestors);
	if (binding) return binding;
	if (node.id) return node.id.name;
	const { parent } = parentOf(node, ancestors);
	if (parent?.type === "CallExpression" && parent.callee.type === "Identifier") {
		return `${parent.callee.name}(…)`;
	}
	return null;
}

function isHookCallee(node: Node) {
	if (node.type === "Identifier") return HOOK_NAME.test(node.name);
	return (
		node.type === "MemberExpression" &&
		!node.computed &&
		node.object.type === "Identifier" &&
		/^[A-Z]/.test(node.object.name) &&
		node.property.type === "Identifier" &&
		HOOK_NAME.test(node.property.name)
	);
}

/** Nodes in `fn`'s own params and body that pass `test`, in source order; nested functions and classes are not searched. */
function ownNodes(fn: FunctionNode, test: (node: Node) => boolean) {
	const found: Node[] = [];
	const search = (node: Node) => {
		if (test(node)) found.push(node);
		for (const child of children(node)) if (!isFunction(child) && !isClass(child)) search(child);
	};
	for (const node of [...fn.params, fn.body]) search(node);
	return found;
}

function callsHooksOrCreatesJsx(fn: FunctionNode) {
	return (
		ownNodes(
			fn,
			(node) =>
				node.type === "JSXElement" ||
				node.type === "JSXFragment" ||
				(node.type === "CallExpression" && isHookCallee(node.callee)),
		).length > 0
	);
}

/** A bare `return;` counts too: it cannot be rendering anything. */
function isNonNode(node: Node | null) {
	if (!node) return true;
	return NON_NODE_RETURNS.has(node.type) || (node.type === "Literal" && "bigint" in node);
}

function hasComponentShape(fn: FunctionNode) {
	const [first, second, ...more] = fn.params;
	if (more.length > 0 || first?.type === "RestElement") return false;
	const ref = second?.type === "AssignmentPattern" ? second.left : second;
	if (ref && !(ref.type === "Identifier" && /ref|Ref/.test(ref.name))) return false;
	if (fn.body.type !== "BlockStatement") return !isNonNode(fn.body);
	// Only the last `return` in the source counts, as in the compiler.
	const last = ownNodes(fn, (node) => node.type === "ReturnStatement").at(-1);
	return !(last?.type === "ReturnStatement" && isNonNode(last.argument));
}

function findDirective(statements: Node[], directives: string[]): OptOut | null {
	for (const statement of statements) {
		if (statement.type !== "ExpressionStatement" || !statement.directive) break;
		if (directives.includes(statement.directive)) {
			return { directive: statement.directive, start: statement.start };
		}
	}
	return null;
}

function ownDirective(fn: FunctionNode, directives: string[]) {
	return fn.body.type === "BlockStatement" ? findDirective(fn.body.body, directives) : null;
}

function unitName(node: FunctionNode, parent: Node | undefined) {
	if (node.type === "FunctionDeclaration") return node.id?.name ?? "";
	return parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
		? parent.id.name
		: "";
}

function isCompilerUnit(node: FunctionNode, ancestors: Node[]) {
	if (ownDirective(node, OPT_IN_DIRECTIVES)) return true;
	const { parent, child } = parentOf(node, ancestors);
	if (isWrappedArgument(parent, child)) {
		return UNIT_WRAPPERS.has(calleeName(parent.callee) ?? "") && callsHooksOrCreatesJsx(node);
	}
	// Unlike a `memo` argument, a variable's function is not looked for through `as`/`satisfies`.
	const name = unitName(node, ancestors.at(-1));
	if (HOOK_NAME.test(name)) return callsHooksOrCreatesJsx(node);
	return UNIT_NAME.test(name) && hasComponentShape(node) && callsHooksOrCreatesJsx(node);
}

function collectUnits(program: Program) {
	const units: Unit[] = [];
	const moduleOptOut = findDirective(program.body, OPT_OUT_DIRECTIVES);
	function visit(node: Node, ancestors: Node[], owners: string[], inUnit: boolean) {
		if (isClass(node)) return;
		let nextOwners = owners;
		let nextInUnit = inUnit;
		if (isFunction(node)) {
			const own = ownName(node, ancestors);
			if (!inUnit && isCompilerUnit(node, ancestors)) {
				units.push({
					start: node.start,
					end: node.end,
					name: [...owners, own ?? "<anonymous>"].join("."),
					optOut: moduleOptOut ?? ownDirective(node, OPT_OUT_DIRECTIVES),
				});
				nextInUnit = true;
			}
			if (own) nextOwners = [...owners, own];
		}
		const path = [...ancestors, node];
		for (const child of children(node)) visit(child, path, nextOwners, nextInUnit);
	}
	visit(program, [], [], false);
	return units;
}

function assertDistinctUnits(file: string, units: Unit[]) {
	const starts = new Map<string, number>();
	for (const unit of units) {
		if ((starts.get(unit.name) ?? unit.start) !== unit.start) {
			throw new Error(
				`compiler-census: ${file} has two compiler units named ${unit.name}; rename one so the baseline can tell them apart`,
			);
		}
		starts.set(unit.name, unit.start);
	}
}

function lineAt(code: string, offset: number) {
	return code.slice(0, offset).split("\n").length;
}

function toBailout(file: string, code: string, units: Unit[], error: OxcError): Bailout {
	const label = error.labels[0];
	const offset = label ? Buffer.from(code).subarray(0, label.start).toString("utf8").length : null;
	const unit = offset === null ? undefined : units.find((u) => u.start <= offset && offset < u.end);
	if (offset === null || !unit) {
		// A line-number key would churn on every edit above it, so refuse to write one.
		throw new Error(
			`compiler-census: ${file}:${offset === null ? "?" : lineAt(code, offset)}: the compiler reported "${error.message}" outside every function the census counts as a compiler unit. If a file-wide lint suppression caused it, move the suppression into the function. Otherwise the census unit rule (isCompilerUnit, "Census units" in scripts/SPEC.md) no longer matches the compiler.`,
		);
	}
	return {
		file,
		line: lineAt(code, offset),
		fnLine: lineAt(code, unit.start),
		fnName: unit.name,
		reason: error.message,
		description: error.helpMessage,
		category: error.codeframe?.match(/react-compiler\((\w+)\)/)?.[1] ?? error.severity,
	};
}

function toSkip(file: string, code: string, unit: Unit, { directive, start }: OptOut): Bailout {
	return {
		file,
		line: lineAt(code, start),
		fnLine: lineAt(code, unit.start),
		fnName: unit.name,
		reason: `Skipped due to '${directive}' directive.`,
		description: null,
		category: "Skip",
	};
}

export function censusFile(absPath: string, code: string): FileResult {
	const file = relative(WEB_ROOT, absPath);
	if (!CODE_FILTER.test(code)) return { memoized: 0, bailouts: [] };
	const parsed = parseSync(absPath, code, { preserveParens: false });
	if (parsed.errors.length > 0) throw new Error(`compiler-census: could not parse ${file}`);
	const units = collectUnits(parsed.program);
	assertDistinctUnits(file, units);
	const result = transformSync(absPath, code, {
		jsx: "preserve",
		reactCompiler: { ...COMPILER_OPTIONS, reportDiagnostics: true },
	});
	if (result.fatal) {
		throw new Error(
			`compiler-census: could not compile ${file}: ${result.errors.map((e) => e.message).join("; ")}`,
		);
	}
	return {
		memoized: result.code.match(MEMO_CACHE)?.length ?? 0,
		bailouts: [
			...units.flatMap((unit) => (unit.optOut ? [toSkip(file, code, unit, unit.optOut)] : [])),
			...result.errors.map((error) => toBailout(file, code, units, error)),
		],
	};
}

function countBy(items: Bailout[], key: (b: Bailout) => string) {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function bailedFunctionKey(b: Bailout) {
	return `${b.file}:${b.fnLine}`;
}

function runCensus() {
	const files = designSourceFiles().filter((file) => /\.tsx?$/.test(file) && !EXCLUDED.test(file));
	const results = files.map((file) => censusFile(file, readFileSync(file, "utf8")));
	const bailouts = results.flatMap((r) => r.bailouts);
	const bailedFunctions = new Set(bailouts.map(bailedFunctionKey)).size;
	return {
		options: COMPILER_OPTIONS,
		filesScanned: files.length,
		memoized: results.reduce((sum, r) => sum + r.memoized, 0),
		bailedFunctions,
		bailoutCount: bailouts.length,
		byCategory: Object.fromEntries(countBy(bailouts, (b) => b.category)),
		byFile: Object.fromEntries(countBy(bailouts, (b) => b.file)),
		bailouts,
	};
}

function printHuman(census: ReturnType<typeof runCensus>) {
	for (const b of census.bailouts) {
		console.log(`${b.file}:${b.line}: [${b.fnName}] ${b.category}: ${b.reason}`);
	}
	console.log("");
	console.log(
		`compiler-census: ${census.bailoutCount} bail-out reasons in ${census.bailedFunctions} functions across ${Object.keys(census.byFile).length} files; ${census.memoized} functions memoized; ${census.filesScanned} files scanned`,
	);
	for (const [category, count] of Object.entries(census.byCategory)) {
		console.log(`  ${category}: ${count}`);
	}
}

export function baselineEntries(bailouts: Bailout[]) {
	const functions = new Set(bailouts.map((b) => `${b.file.split(sep).join("/")} ${b.fnName}`));
	return [...functions].sort();
}

function reportDrift({ path, content }: GeneratedFile) {
	const lines = (text: string) => new Set(normalizeEol(text).split("\n").filter(Boolean));
	const committed = lines(existsSync(path) ? readFileSync(path, "utf8") : "");
	const current = lines(content);
	for (const fn of current) {
		if (!committed.has(fn)) console.error(`compiler-census: new bail-out: ${fn}`);
	}
	for (const fn of committed) {
		if (!current.has(fn)) console.error(`compiler-census: now compiles: ${fn}`);
	}
}

if (import.meta.main) {
	const census = runCensus();
	const check = process.argv.includes("--check");
	if (process.argv.includes("--json")) console.log(JSON.stringify(census, null, 2));
	else if (check || process.argv.includes("--write")) {
		const output = {
			path: BASELINE,
			content: `${baselineEntries(census.bailouts).join("\n")}\n`,
		};
		if (check) reportDrift(output);
		writeOrCheck({ label: "compiler:census", version: "1", outputs: [output], check });
	} else printHuman(census);
}
