#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Regenerate `src/i18n/keys.ts` from the code.
 *
 * The registry must equal the set of literal keys call sites actually pass to `t()`. Deriving it from
 * the source (rather than from a separate extraction pass) makes that equality structural: a codemod
 * run followed by this script cannot leave the registry describing a different string than the one the
 * component renders.
 *
 *   bun scripts/i18n-keys.ts --write
 *   bun scripts/i18n-keys.ts            # report drift only, exit 1 when stale
 */
import * as ts from "typescript";

const rootArg = process.argv.indexOf("--root");
const root = rootArg >= 0 ? (process.argv[rootArg + 1] ?? "src") : "src";
const shouldWrite = process.argv.includes("--write");
const OUTPUT = join(root, "i18n", "keys.ts");

const SKIP =
	/(?:^|\/)(?:generated|node_modules|dist|i18n)(?:\/|$)|\.(?:test|spec)\.[cm]?tsx?$|\.d\.ts$/;

function walk(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (SKIP.test(p)) continue;
		if (statSync(p).isDirectory()) walk(p, acc);
		else if (/\.[cm]?tsx?$/.test(p)) acc.push(p);
	}
	return acc;
}

const keys = new Set<string>();

/**
 * Module-level string tables are a legitimate second source of keys: a `STATUS_LABEL` map stays
 * language-independent and each read site calls `t(STATUS_LABEL[status])`. Those calls pass no literal,
 * so the registry would silently miss every value in the table — and a missing key is a message that
 * renders English in a translated locale. Resolving the referenced declaration keeps the registry equal
 * to what the UI can actually render.
 */
function stringValuesOf(node: ts.Node | undefined, into: Set<string>): void {
	if (!node) return;
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		if (node.text !== "") into.add(node.text);
	} else if (ts.isObjectLiteralExpression(node))
		for (const prop of node.properties) stringValuesOf(prop, into);
	else if (ts.isPropertyAssignment(node)) stringValuesOf(node.initializer, into);
	else if (ts.isArrayLiteralExpression(node))
		for (const element of node.elements) stringValuesOf(element, into);
	else if (ts.isConditionalExpression(node)) {
		stringValuesOf(node.whenTrue, into);
		stringValuesOf(node.whenFalse, into);
	}
}

/**
 * `t(cond ? "A" : "B")` is a single call site that can render either string, so both branches are keys.
 * Resolving them here keeps that pattern as measurable as a plain literal.
 */
function collectArgument(node: ts.Node | undefined, sf: ts.SourceFile, into: Set<string>): void {
	if (!node) return;
	if (ts.isStringLiteral(node)) {
		// `t(TABLE[id] ?? "")` — the empty fallback renders nothing, so it is not a message.
		if (node.text !== "") into.add(node.text);
		return;
	}
	if (ts.isConditionalExpression(node)) {
		collectArgument(node.whenTrue, sf, into);
		collectArgument(node.whenFalse, sf, into);
		return;
	}
	// `t(TABLE[id] ?? "")`: the fallback is empty, the table still supplies every rendered string.
	if (ts.isBinaryExpression(node)) {
		collectArgument(node.left, sf, into);
		collectArgument(node.right, sf, into);
		return;
	}
	const root = rootIdentifier(node);
	if (root) stringValuesOf(initializerFor(sf, root), into);
}

/** The declaration a `t(…)` argument ultimately reads from: `NAME`, `NAME.key`, or `NAME[expr]`. */
function rootIdentifier(node: ts.Node): string | undefined {
	if (ts.isIdentifier(node)) return node.text;
	if (ts.isPropertyAccessExpression(node)) return rootIdentifier(node.expression);
	if (ts.isElementAccessExpression(node)) return rootIdentifier(node.expression);
	return undefined;
}

function initializerFor(sf: ts.SourceFile, name: string): ts.Node | undefined {
	let found: ts.Node | undefined;
	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === name &&
			node.initializer
		) {
			found = node.initializer;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

for (const file of walk(root)) {
	const text = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
	const visit = (node: ts.Node) => {
		// `t("…")` or `t("…", arg, …)`: the call this module exists to collect.
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "t"
		) {
			// `t("…")`, `t(STATUS_LABEL[status])`, `t(cond ? "A" : "B")`: the table or branch a call
			// reads from stays English, so every value it can render is a key.
			collectArgument(node.arguments[0], sf, keys);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
}

/**
 * Built-in extensions describe themselves in the host manifest, and `ExtensionsSettings` renders that
 * copy through `t(entry.title)`. The manifest is the single source of the English, so the registry reads
 * it from there: rewording a manifest without translating it then fails `i18n:check` instead of quietly
 * leaving English on the settings page.
 */
function collectExtensionCopy(dir: string): void {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return; // A checkout without the extensions workspace has nothing to contribute.
	}
	for (const name of names) {
		const manifest = join(dir, name, "server", "index.ts");
		let text: string;
		try {
			text = readFileSync(manifest, "utf8");
		} catch {
			continue;
		}
		const sf = ts.createSourceFile(manifest, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
		const visit = (node: ts.Node) => {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "defineServerExtension"
			) {
				const config = node.arguments[0];
				if (config && ts.isObjectLiteralExpression(config)) {
					for (const prop of config.properties) {
						if (
							ts.isPropertyAssignment(prop) &&
							ts.isIdentifier(prop.name) &&
							(prop.name.text === "title" || prop.name.text === "description")
						)
							collectArgument(prop.initializer, sf, keys);
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
}

// `root` is `src`, so the extensions workspace sits three levels up from it.
collectExtensionCopy(join(root, "..", "..", "..", "thinkrail-extensions"));

const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// JSON.stringify is the only quoting that survives every key: a source string may contain a newline,
// a tab or a quote, and any of them written raw leaves the registry with an unterminated literal.
const quote = (value: string) => JSON.stringify(value);
const content = `/**
 * The message registry — every key is the English source string it replaces, derived from the \`t()\`
 * call sites by \`scripts/i18n-keys.ts\`.
 *
 * The English copy is not duplicated here: it stays in the components, and a key the catalog does not
 * carry returns its own source string. This list exists so a locale's coverage can be measured against
 * a set that provably equals what the UI renders.
 *
 * GENERATED by \`bun run i18n:keys\` — do not edit by hand.
 */
export const MESSAGE_KEYS = [
${sorted.map((key) => `\t${quote(key)},`).join("\n")}
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];
`;

const current = (() => {
	try {
		return readFileSync(OUTPUT, "utf8");
	} catch {
		return "";
	}
})();

if (shouldWrite) {
	writeFileSync(OUTPUT, content);
	console.log(`i18n-keys: wrote ${sorted.length} keys`);
} else if (current !== content) {
	console.error(`i18n-keys: ${OUTPUT} is stale — run \`bun run i18n:keys\``);
	process.exit(1);
} else {
	console.log(`i18n-keys: OK (${sorted.length} keys)`);
}
