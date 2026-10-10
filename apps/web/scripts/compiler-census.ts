#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { type NodePath, parseSync, transformFromAstSync, traverse, type types } from "@babel/core";
import {
	type LoggerEvent,
	type PluginOptions,
	parsePluginOptions,
} from "babel-plugin-react-compiler";
import { designSourceFiles } from "./designSources";
import { type GeneratedFile, normalizeEol, writeOrCheck } from "./generatedFiles";

// Must match `reactCompilerPreset()` in vite.config.ts.
const COMPILER_OPTIONS: PluginOptions = {};
const PRESET_FILTER = /\b[A-Z]|\buse/;

const WEB_ROOT = resolve(import.meta.dir, "..");
const BASELINE = resolve(import.meta.dir, "compiler-census.baseline.txt");
const EXCLUDED = /\.(test|spec|stories)\.[tj]sx?$/;

interface Bailout {
	file: string;
	line: number;
	fnLine: number | null;
	fnName: string | null;
	kind: "CompileError" | "CompileSkip" | "PipelineError";
	reason: string;
	description: string | null;
	category: string;
}

interface FileResult {
	compiled: number;
	bailouts: Bailout[];
}

function locKey(loc: types.SourceLocation | null | undefined) {
	return loc ? `${loc.start.line}:${loc.start.column}` : "";
}

function functionName(path: NodePath<types.Function>) {
	const { node, parent } = path;
	if ("id" in node && node.id) return node.id.name;
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
		return parent.id.name;
	if (parent.type === "ExportDefaultDeclaration") return "default";
	if (parent.type === "CallExpression" && parent.callee.type === "Identifier") {
		return `${parent.callee.name}(…)`;
	}
	return null;
}

function collectFunctionNames(ast: types.File) {
	const names = new Map<string, string>();
	traverse(ast, {
		Function(path) {
			const name = functionName(path);
			if (name) names.set(locKey(path.node.loc), name);
		},
	});
	return names;
}

function toBailout(file: string, names: Map<string, string>, event: LoggerEvent): Bailout | null {
	if (
		event.kind !== "CompileError" &&
		event.kind !== "CompileSkip" &&
		event.kind !== "PipelineError"
	) {
		return null;
	}
	const fnLine = event.fnLoc?.start.line ?? null;
	const fnName = names.get(locKey(event.fnLoc)) ?? null;
	if (event.kind === "CompileError") {
		const loc = event.detail.primaryLocation();
		return {
			file,
			line: (typeof loc === "object" && loc?.start.line) || fnLine || 0,
			fnLine,
			fnName,
			kind: event.kind,
			reason: event.detail.reason,
			description: event.detail.description ?? null,
			category: event.detail.category,
		};
	}
	if (event.kind === "CompileSkip") {
		return {
			file,
			line: event.loc?.start.line ?? fnLine ?? 0,
			fnLine,
			fnName,
			kind: event.kind,
			reason: event.reason,
			description: null,
			category: "Skip",
		};
	}
	return {
		file,
		line: fnLine ?? 0,
		fnLine,
		fnName,
		kind: event.kind,
		reason: event.data,
		description: null,
		category: "Pipeline",
	};
}

function censusFile(absPath: string, code: string): FileResult {
	const file = relative(WEB_ROOT, absPath);
	if (!PRESET_FILTER.test(code)) return { compiled: 0, bailouts: [] };
	const ast = parseSync(code, {
		babelrc: false,
		configFile: false,
		filename: absPath,
		parserOpts: { plugins: absPath.endsWith("x") ? ["jsx", "typescript"] : ["typescript"] },
	});
	if (!ast) throw new Error(`compiler-census: could not parse ${file}`);
	const names = collectFunctionNames(ast);
	const events: LoggerEvent[] = [];
	const options: PluginOptions = {
		...COMPILER_OPTIONS,
		logger: { logEvent: (_filename, event) => events.push(event) },
	};
	transformFromAstSync(ast, code, {
		babelrc: false,
		configFile: false,
		filename: absPath,
		code: false,
		cloneInputAst: false,
		plugins: [["babel-plugin-react-compiler", options]],
	});
	return {
		compiled: events.filter((e) => e.kind === "CompileSuccess").length,
		bailouts: events.flatMap((e) => toBailout(file, names, e) ?? []),
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
	const { target, compilationMode, panicThreshold } = parsePluginOptions(COMPILER_OPTIONS);
	const files = designSourceFiles().filter((file) => /\.tsx?$/.test(file) && !EXCLUDED.test(file));
	const results = files.map((file) => censusFile(file, readFileSync(file, "utf8")));
	const bailouts = results.flatMap((r) => r.bailouts);
	const bailedFunctions = new Set(bailouts.map(bailedFunctionKey)).size;
	return {
		options: { target, compilationMode, panicThreshold },
		filesScanned: files.length,
		compiled: results.reduce((sum, r) => sum + r.compiled, 0),
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
		`compiler-census: ${census.bailoutCount} bail-out reasons in ${census.bailedFunctions} functions across ${Object.keys(census.byFile).length} files; ${census.compiled} functions compiled; ${census.filesScanned} files scanned`,
	);
	for (const [category, count] of Object.entries(census.byCategory)) {
		console.log(`  ${category}: ${count}`);
	}
}

function baseline(census: ReturnType<typeof runCensus>): GeneratedFile {
	const functions = new Set(
		census.bailouts.map(
			(b) => `${b.file.split(sep).join("/")} ${b.fnName ?? `:${b.fnLine ?? b.line}`}`,
		),
	);
	return { path: BASELINE, content: `${[...functions].sort().join("\n")}\n` };
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
		const output = baseline(census);
		if (check) reportDrift(output);
		writeOrCheck({ label: "compiler:census", version: "1", outputs: [output], check });
	} else printHuman(census);
}
