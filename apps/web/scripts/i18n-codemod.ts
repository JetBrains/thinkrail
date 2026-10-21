#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
/**
 * i18n codemod: wrap translatable UI copy in `t("…")`.
 *
 * Only contexts where the string is unambiguously user-facing copy are rewritten:
 *
 *   A  a JSX element/fragment whose sole meaningful child is a text node      <p>Send</p>
 *   B  a string-literal value of a surface attribute                          aria-label="Send"
 *   C  a string-literal value of a known rendered-text prop                   { label: "Send" }
 *   D  a template literal in any of those positions, placeholders hoisted      `Close ${name}`
 *
 * Everything else — wiring, ids, urls, class names, error messages, svg path data, test ids — is left
 * alone and reported, because rewriting those would break behavior rather than translate it.
 *
 *   bun scripts/i18n-codemod.ts --write          # apply
 *   bun scripts/i18n-codemod.ts --json out.json  # report only
 */
import * as ts from "typescript";

const rootArg = process.argv.indexOf("--root");
const root = rootArg >= 0 ? (process.argv[rootArg + 1] ?? "src") : "src";
const shouldWrite = process.argv.includes("--write");
const jsonOut = process.argv.includes("--json")
	? process.argv[process.argv.indexOf("--json") + 1]
	: null;

/** Directories whose contents are generated, vendored, or not user-facing. */
const SKIP =
	/(?:^|\/)(?:generated|node_modules|dist|dist-profile|themes)(?:\/|$)|\.(?:test|spec)\.[cm]?tsx?$|\.d\.ts$/;

/**
 * Sinks that take user-facing copy as their first positional argument.
 */
const COPY_CALLEES =
	/^(?:toast(?:\.(?:error|success|info|warning|message))?|setError|setMessage|errorText|errors\.push|new Error|fail|notify)$/;

/**
 * Assignment targets that hold copy: `let label = "…"`, `iconButton.title = "…"`.
 */
const COPY_TARGETS =
	/(?:^|\.)(?:label|title|ariaLabel|description|message|text|detail|reason|notice)$/;

const SURFACE_ATTRS = new Set([
	"label",
	"aria-label",
	"title",
	"placeholder",
	"description",
	"confirmLabel",
	"emptyLabel",
	"heading",
	"alt",
	"tooltip",
	"hint",
]);
const TEXT_PROPS = new Set([
	"subtitle",
	"runningLabel",
	"reason",
	"detail",
	"notice",
	"initialText",
	"emptyText",
	"caption",
	"blurb",
	"statusLabel",
	"buttonLabel",
	"label",
	"title",
	"description",
	"placeholder",
	"tooltip",
	"ariaLabel",
	"emptyLabel",
	"heading",
	"confirmLabel",
	"message",
	"hint",
	"text",
]);

function walk(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (SKIP.test(p)) continue;
		if (statSync(p).isDirectory()) walk(p, acc);
		else if (/\.[cm]?tsx?$/.test(p)) acc.push(p);
	}
	return acc;
}

/**
 * True when the value reads as prose a user sees, rather than an id, path, url, or token.
 *
 * Placeholders are stripped first, so a translation-ready skeleton like `"{0}: {0}"` is judged on the
 * text that actually reaches the reader (here: `": "`, punctuation-only, hence not copy).
 */
function looksLikeCopy(value: string): boolean {
	const raw = value.trim();
	// Already translated (or authored) in Chinese: nothing to do, and re-wrapping it would only add a
	// Chinese-to-Chinese catalog entry.
	if (/[\u3400-\u9fff]/.test(raw)) return false;
	const v = raw.replace(/\{\d+\}/g, "").trim();
	if (v.length === 0 || v.length > 400) return false;
	if (!/[A-Za-z]/.test(v)) return false;
	// A single capitalized word is a UI label ("Fixed", "Light", "Personal"); a single lowercase
	// token is an id, a css name, or a slug.
	if (!v.includes(" ")) {
		if (!/^[A-Z]/.test(v)) return false;
		return !/[\d_]/.test(v) && v.length >= 2 && !/(?:[a-z][A-Z])/.test(v);
	}
	if (/^(?:https?:|data:|mailto:|#|\/|\.\.?\/|~\/)/.test(v)) return false;
	// Every word lowercase (with hyphens or dots) is a class list, a css token, a slug or a command
	// line — never a sentence a reader sees. Display copy in this codebase always carries at least one
	// capitalized word.
	if (/^[a-z0-9][a-z0-9.:@/~_-]*(?:\s+[a-z0-9][a-z0-9.:@/~_-]*)*$/.test(v)) return false;
	// Storage keys and id templates ("added:{0}:{1}", "terminal:{0}").
	if (/^[a-z0-9_-]+:\{?\d/.test(raw)) return false;
	// ANSI escapes and other brace/bracket control soup.
	if (/\[[\d;]*m/.test(raw)) return false;
	// CSS values and utility-class fragments ("rounded-[var(--radius-xs)] bg-primary-muted").
	if (/var\(--/.test(raw) || /^[a-z-]+-\[/.test(raw)) return false;
	return true;
}

function soleTextChild(el: ts.JsxElement | ts.JsxFragment): ts.JsxText | null {
	const meaningful = el.children.filter((c) => !ts.isJsxText(c) || c.text.trim().length > 0);
	const only = meaningful.length === 1 ? meaningful[0] : undefined;
	return only !== undefined && ts.isJsxText(only) ? only : null;
}

/** `${expr}` becomes `{0}` (or `{1}`, …); the expressions are returned in order. */
function templateParts(node: ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral): {
	text: string;
	exprs: string[];
} {
	if (ts.isNoSubstitutionTemplateLiteral(node))
		return { text: node.text.replace(/\s+/g, " ").trim(), exprs: [] };
	const exprs: string[] = [];
	let text = node.head.text;
	for (const span of node.templateSpans) {
		exprs.push(span.expression.getText());
		text += `{${exprs.length - 1}}${span.literal.text}`;
	}
	return { text: text.replace(/\s+/g, " ").trim(), exprs };
}

const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

interface Edit {
	start: number;
	end: number;
	text: string;
	kind: string;
	value: string;
}

const allEdits: Edit[] = [];
const allSkipped: Array<{ file: string; line: number; value: string; reason: string }> = [];
let touched = 0;

for (const file of walk(root)) {
	const sourceText = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
	const rel = relative(process.cwd(), file);
	const edits: Edit[] = [];
	const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

	/**
	 * `{ brace }` marks a site whose text is not already a JS expression: a string-literal attribute
	 * value (`aria-label="Send"`) and a JSX text node both need the container braces. A value already
	 * inside `{…}` and a property initializer do not.
	 */
	const wrap = (node: ts.Node, kind: string, text: string, exprs: string[], brace: boolean) => {
		// `t("Close {0}", name)` — one argument per placeholder, in order.
		const args = exprs.length > 0 ? `, ${exprs.join(", ")}` : "";
		const call = `t(${quote(text)}${args})`;
		edits.push({
			start: node.getStart(sf),
			end: node.getEnd(),
			text: brace ? `{${call}}` : call,
			kind,
			value: text,
		});
	};

	/** Wrap a leaf expression (string or template literal) when it reads as copy. */
	const wrapLeafAt = (leaf: ts.Node, kind: string, brace: boolean) => {
		if (ts.isStringLiteral(leaf)) {
			if (looksLikeCopy(leaf.text)) wrap(leaf, kind, leaf.text, [], brace);
		} else if (ts.isTemplateExpression(leaf) || ts.isNoSubstitutionTemplateLiteral(leaf)) {
			const { text, exprs } = templateParts(leaf);
			if (looksLikeCopy(text)) wrap(leaf, `${kind}:template`, text, exprs, brace);
		}
	};

	const visit = (node: ts.Node) => {
		if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
			const only = soleTextChild(node as ts.JsxElement);
			if (only) {
				const value = only.text.replace(/\s+/g, " ").trim();
				if (looksLikeCopy(value)) {
					// The text node carries its own surrounding whitespace; wrap the trimmed value only.
					const raw = only.getText(sf);
					const leading = raw.length - raw.trimStart().length;
					const trailing = raw.length - raw.trimEnd().length;
					edits.push({
						start: only.getStart(sf) + leading,
						end: only.getEnd() - trailing,
						text: `{t(${quote(value)})}`,
						kind: "jsx-text",
						value,
					});
				} else if (value.length > 0) {
					allSkipped.push({ file: rel, line: lineOf(only), value, reason: "jsx-text:not-copy" });
				}
			}
		} else if (
			ts.isJsxExpression(node) &&
			node.expression &&
			!(node.parent && ts.isJsxAttribute(node.parent))
		) {
			// `{cond ? "Light" : "Dark"}` and `{"Send"}` — copy that lives in an expression child
			// rather than in JSX text. Only string literals (and template literals) are wrapped; a
			// conditional *condition* or a call is never touched.
			const expr = node.expression;
			const wrapLeaf = (leaf: ts.Node) => {
				if (ts.isStringLiteral(leaf)) {
					if (looksLikeCopy(leaf.text)) wrap(leaf, "jsx-expr-key", leaf.text, [], false);
				} else if (ts.isTemplateExpression(leaf) || ts.isNoSubstitutionTemplateLiteral(leaf)) {
					const { text, exprs } = templateParts(leaf);
					if (looksLikeCopy(text)) wrap(leaf, "jsx-expr-template", text, exprs, false);
				}
			};
			if (ts.isConditionalExpression(expr)) {
				wrapLeaf(expr.whenTrue);
				wrapLeaf(expr.whenFalse);
			} else {
				wrapLeaf(expr);
			}
		} else if (ts.isCallExpression(node) && node.arguments.length > 0) {
			// Notifications and error sinks take their copy as a positional argument rather than a
			// named prop, so they need their own rule: `toast.error("…")`, `setError("…")`,
			// `errors.push("…")`, `errorText("…")`, `new Error("…")`.
			const callee = node.expression.getText(sf);
			if (COPY_CALLEES.test(callee)) {
				const first = node.arguments[0];
				if (first) wrapLeafAt(first, `call:${callee}`, false);
			}
		} else if (ts.isReturnStatement(node) && node.expression) {
			// A returned literal is copy when it reads as a sentence — the shape gate keeps status
			// codes (`return "idle"`) and identifiers out.
			wrapLeafAt(node.expression, "return", false);
		} else if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken
		) {
			const target = node.left.getText(sf);
			if (COPY_TARGETS.test(target)) wrapLeafAt(node.right, `assign:${target}`, false);
		} else if (ts.isJsxAttribute(node)) {
			const name = node.name.getText();
			const init = node.initializer;
			if (init && ts.isStringLiteral(init)) {
				if (SURFACE_ATTRS.has(name)) {
					if (looksLikeCopy(init.text)) wrap(init, `attr:${name}`, init.text, [], true);
					else
						allSkipped.push({
							file: rel,
							line: lineOf(init),
							value: init.text,
							reason: `attr:${name}:not-copy`,
						});
				}
			} else if (init && ts.isJsxExpression(init) && init.expression) {
				const expr = init.expression;
				if (ts.isStringLiteral(expr) && SURFACE_ATTRS.has(name) && looksLikeCopy(expr.text)) {
					wrap(expr, `attr:${name}`, expr.text, [], false);
				} else if (
					(ts.isTemplateExpression(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) &&
					SURFACE_ATTRS.has(name)
				) {
					const { text, exprs } = templateParts(expr);
					if (looksLikeCopy(text) && text.includes(" "))
						wrap(expr, `attr:${name}:template`, text, exprs, false);
				}
			}
		} else if (ts.isPropertyAssignment(node) && TEXT_PROPS.has(node.name.getText())) {
			const name = node.name.getText();
			const init = node.initializer;
			if (ts.isStringLiteral(init) && looksLikeCopy(init.text))
				wrap(init, `prop:${name}`, init.text, [], false);
			else if (ts.isTemplateExpression(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
				const { text, exprs } = templateParts(init);
				if (looksLikeCopy(text) && text.includes(" "))
					wrap(init, `prop:${name}:template`, text, exprs, false);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);

	allEdits.push(...edits);
	if (!shouldWrite || edits.length === 0) continue;

	// Splice forward over ascending offsets, skipping any edit nested inside one already applied.
	const ordered = [...edits].sort((a, b) => a.start - b.start);
	const pieces: string[] = [];
	let cursor = 0;
	for (const edit of ordered) {
		if (edit.start < cursor) continue;
		pieces.push(sourceText.slice(cursor, edit.start), edit.text);
		cursor = edit.end;
	}
	pieces.push(sourceText.slice(cursor));
	writeFileSync(file, ensureImport(pieces.join(""), sf));
	touched++;
}

/** Adds `import { t } from "@/i18n";` after the last existing import (or at the top when there is none). */
function ensureImport(text: string, sf: ts.SourceFile): string {
	if (/\bfrom\s*"@\/i18n"/.test(text)) return text;
	const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
	const last = imports.at(-1);
	const line = last ? sf.getLineAndCharacterOfPosition(last.getEnd()).line + 1 : 0;
	const lines = text.split("\n");
	lines.splice(line, 0, 'import { t } from "@/i18n";');
	return lines.join("\n");
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(allSkipped, null, 1));
const byKind: Record<string, number> = {};
for (const edit of allEdits) byKind[edit.kind] = (byKind[edit.kind] ?? 0) + 1;
console.log(
	JSON.stringify(
		{ edits: allEdits.length, byKind, skipped: allSkipped.length, filesWritten: touched },
		null,
		1,
	),
);
