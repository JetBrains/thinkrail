#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
	type ArrowFunctionExpression,
	type Function as FunctionLike,
	type Node,
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

const WEB_ROOT = resolve(import.meta.dir, "..");
const BASELINE = resolve(import.meta.dir, "compiler-census.baseline.txt");
const EXCLUDED = /\.(test|spec|stories)\.[tj]sx?$/;

interface Bailout {
	file: string;
	line: number;
	fnLine: number | null;
	fnName: string | null;
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
}

type FunctionNode = FunctionLike | ArrowFunctionExpression;

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

function bindingName(node: Node, ancestors: Node[]): string | null {
	const parent = ancestors.at(-1);
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
	if (parent.type === "CallExpression" && parent.callee !== node) {
		return bindingName(parent, ancestors.slice(0, -1));
	}
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
	const parent = ancestors.at(-1);
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

function callsHooksOrCreatesJsx(node: Node): boolean {
	if (node.type === "JSXElement" || node.type === "JSXFragment") return true;
	if (node.type === "CallExpression" && isHookCallee(node.callee)) return true;
	return children(node).some(callsHooksOrCreatesJsx);
}

function unitName(node: FunctionNode, parent: Node | undefined) {
	if (node.type === "FunctionDeclaration") return node.id?.name ?? "";
	return parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
		? parent.id.name
		: "";
}

function isCompilerUnit(node: FunctionNode, ancestors: Node[]) {
	const parent = ancestors.at(-1);
	const unitShaped =
		parent?.type === "CallExpression" && parent.callee !== node
			? UNIT_WRAPPERS.has(calleeName(parent.callee) ?? "")
			: UNIT_NAME.test(unitName(node, parent));
	return unitShaped && callsHooksOrCreatesJsx(node);
}

function collectUnits(program: Node) {
	const units: Unit[] = [];
	function visit(node: Node, ancestors: Node[], owners: string[], inUnit: boolean) {
		let nextOwners = owners;
		let nextInUnit = inUnit;
		if (isFunction(node)) {
			const own = ownName(node, ancestors);
			if (!inUnit && isCompilerUnit(node, ancestors)) {
				units.push({
					start: node.start,
					end: node.end,
					name: [...owners, own ?? "<anonymous>"].join("."),
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

function toBailout(file: string, code: string, units: Unit[], error: OxcError): Bailout {
	const lineAt = (offset: number) => code.slice(0, offset).split("\n").length;
	const label = error.labels[0];
	const offset = label ? Buffer.from(code).subarray(0, label.start).toString("utf8").length : null;
	const unit = offset === null ? undefined : units.find((u) => u.start <= offset && offset < u.end);
	const fnLine = unit ? lineAt(unit.start) : null;
	return {
		file,
		line: offset === null ? (fnLine ?? 0) : lineAt(offset),
		fnLine,
		fnName: unit?.name ?? null,
		reason: error.message,
		description: error.helpMessage,
		category: error.codeframe?.match(/react-compiler\((\w+)\)/)?.[1] ?? error.severity,
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
		bailouts: result.errors.map((error) => toBailout(file, code, units, error)),
	};
}

function countBy(items: Bailout[], key: (b: Bailout) => string) {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function bailedFunctionKey(b: Bailout) {
	return `${b.file}:${b.fnLine ?? b.line}`;
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
		const fn = b.fnName ? ` [${b.fnName}]` : "";
		console.log(`${b.file}:${b.line}:${fn} ${b.category}: ${b.reason}`);
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
	const functions = new Set(
		bailouts.map((b) => `${b.file.split(sep).join("/")} ${b.fnName ?? `:${b.fnLine ?? b.line}`}`),
	);
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
