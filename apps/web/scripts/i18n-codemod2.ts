#!/usr/bin/env bun
/**
 * Second i18n sweep: copy the first pass structurally could not reach.
 *
 * The first pass wrapped a JSX element's copy only when the element had exactly one text child
 * (`<button>Send</button>`). Copy that shares an element with an icon or a sibling
 * (`<button><Icon /> Skills</button>`) was invisible to it, and so were the copy props and the
 * message arguments it did not recognise. This pass walks the same tree with no such restriction.
 *
 *   bun scripts/i18n-codemod2.ts            # dry run: report only
 *   bun scripts/i18n-codemod2.ts --write    # apply
 *
 * It is idempotent: anything already inside a `t(…)` call is skipped, so re-running after adding new
 * copy only touches what is still bare.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

const shouldWrite = process.argv.includes("--write");
const ROOTS = ["src"];

/**
 * Web sources only. Desktop copy is a separate, much smaller surface — the native menu and the
 * crash/restart dialogs in `apps/desktop/src/menuLocale.ts` — and it must go through that module
 * rather than this codemod: desktop has no `@/*` alias, and its SPEC forbids runtime imports of web
 * source, so an inserted `import { t } from "@/i18n"` would not even resolve there.
 */
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

/**
 * Attributes whose value is read by a person. A value that is a machine token (an id, a css name, a
 * shell command) is filtered out by `looksLikeCopy`, not by this list.
 */
const TEXT_PROPS = new Set([
	"label",
	"title",
	"description",
	"detail",
	"ariaLabel",
	"aria-label",
	"placeholder",
	"emptyText",
	"subtitle",
	"reason",
	"notice",
	"runningLabel",
	"statusLabel",
	"buttonLabel",
	"caption",
	"blurb",
	"confirmLabel",
	"cancelLabel",
	"initialText",
	"helperText",
	"tooltip",
	"heading",
	"summary",
	"prompt",
	"children",
	"errorText",
	"hint",
	"text",
	"body",
	"footer",
	"header",
	"name",
	"displayName",
]);

/** Calls whose string arguments reach a person: banners, toasts, thrown messages. */
const COPY_CALLEES =
	/^(?:toast(?:\.(?:error|success|info|warning|message|loading))?|setError|setMessage|setNotice|errorText|errors\.push|warnings\.push|new Error|new TypeError|fail|notify|setStatus)$/;

/**
 * True when the string reads as interface copy rather than as a machine value.
 *
 * Deliberately conservative in the same direction as the first pass: a wrongly wrapped identifier
 * breaks the build, while a missed label is only cosmetic — and the audit script exists to find those.
 */
function looksLikeCopy(value: string): boolean {
	const raw = value.trim();
	if (!raw || raw.length > 400) return false;
	// Already Chinese: nothing to translate, and a zh→zh catalog entry is noise.
	if (/[\u3400-\u9fff]/.test(raw)) return false;
	if (!/[A-Za-z]/.test(raw)) return false;
	const v = raw.replace(/\{\d+\}/g, "").trim();
	if (!v) return false;
	if (!v.includes(" ")) {
		// One capitalized word is a label; one lowercase token is an id, a class or a slug.
		if (!/^[A-Z]/.test(v)) return false;
		return !/[\d_]/.test(v) && v.length >= 2 && !/[a-z][A-Z]/.test(v);
	}
	if (/^(?:https?:|data:|mailto:|#|\/|\.\.?\/|~\/)/.test(v)) return false;
	// Every word lowercase is a class list, a css token, a slug or a command line.
	if (/^[a-z0-9][a-z0-9.:@/~_-]*(?:\s+[a-z0-9][a-z0-9.:@/~_-]*)*$/.test(v)) return false;
	if (/^[a-z0-9_-]+:\{?\d/.test(raw)) return false;
	if (/\[[\d;]*m/.test(raw)) return false;
	if (/var\(--/.test(raw) || /^[a-z-]+-\[/.test(raw)) return false;
	// A path or a dotted identifier chain.
	if (/^[\w.-]+(?:\/[\w.-]+)+$/.test(v) && !v.includes(" ")) return false;
	return true;
}

const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

type Edit = { start: number; end: number; text: string; kind: string; value: string };
const report: { file: string; line: number; kind: string; value: string }[] = [];
const skipped: { file: string; line: number; value: string; why: string }[] = [];
let filesWritten = 0;
let totalEdits = 0;

for (const root of ROOTS) {
	let files: string[];
	try {
		files = walk(root);
	} catch {
		continue;
	}
	for (const file of files) {
		const source = readFileSync(file, "utf8");
		const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
		const edits: Edit[] = [];
		const rel = file;

		const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

		/** Is this node already an argument of `t(…)`? */
		const insideT = (node: ts.Node): boolean => {
			let cur: ts.Node | undefined = node;
			while (cur) {
				if (
					ts.isCallExpression(cur) &&
					ts.isIdentifier(cur.expression) &&
					cur.expression.text === "t"
				)
					return true;
				cur = cur.parent;
			}
			return false;
		};

		const push = (node: ts.Node, text: string, kind: string, value: string) => {
			edits.push({ start: node.getStart(sf), end: node.getEnd(), text, kind, value });
		};

		const visit = (node: ts.Node) => {
			// 1. JSX text in ANY position, not only as a sole child.
			if (ts.isJsxText(node)) {
				const raw = node.getText(sf);
				const value = raw.replace(/\s+/g, " ").trim();
				if (!value) {
					// Whitespace-only: nothing to say, but it may still separate two inline elements.
				} else if (!looksLikeCopy(value)) {
					skipped.push({ file: rel, line: lineOf(node), value, why: "jsx-text:not-copy" });
				} else {
					// Whitespace on the same line as a sibling is significant; whitespace containing a
					// newline is JSX formatting and is dropped by the compiler anyway.
					const lead = raw.slice(0, raw.length - raw.trimStart().length);
					const trail = raw.slice(raw.trimEnd().length);
					const leadSpace = lead && !lead.includes("\n") ? '{" "}' : "";
					const trailSpace = trail && !trail.includes("\n") ? '{" "}' : "";
					push(node, `${leadSpace}{t(${quote(value)})}${trailSpace}`, "jsx-text", value);
				}
			}

			// 2. `{"Send"}` and `{cond ? "Light" : "Dark"}` in child position.
			if (
				ts.isJsxExpression(node) &&
				node.expression &&
				!(node.parent && ts.isJsxAttribute(node.parent))
			) {
				const leaves: ts.Node[] = [];
				const collect = (n: ts.Node) => {
					if (ts.isConditionalExpression(n)) {
						collect(n.whenTrue);
						collect(n.whenFalse);
					} else if (ts.isStringLiteral(n)) leaves.push(n);
				};
				collect(node.expression);
				for (const leaf of leaves) {
					const lit = leaf as ts.StringLiteral;
					if (insideT(lit)) continue;
					if (looksLikeCopy(lit.text)) push(lit, `t(${quote(lit.text)})`, "jsx-expr", lit.text);
					else
						skipped.push({
							file: rel,
							line: lineOf(lit),
							value: lit.text,
							why: "jsx-expr:not-copy",
						});
				}
			}

			// 3. Copy attributes.
			if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
				const name = node.name.getText(sf);
				const lit = node.initializer;
				if (TEXT_PROPS.has(name) && !insideT(lit)) {
					if (looksLikeCopy(lit.text))
						push(lit, `{t(${quote(lit.text)})}`, `prop:${name}`, lit.text);
					else
						skipped.push({
							file: rel,
							line: lineOf(lit),
							value: lit.text,
							why: `prop:${name}:not-copy`,
						});
				}
			}

			// 4. Message arguments of banners, toasts and thrown errors.
			if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				const callee = node.expression.getText(sf);
				if (COPY_CALLEES.test(callee)) {
					for (const arg of node.arguments ?? []) {
						if (!ts.isStringLiteral(arg) || insideT(arg)) continue;
						if (looksLikeCopy(arg.text))
							push(arg, `t(${quote(arg.text)})`, `call:${callee}`, arg.text);
						else
							skipped.push({
								file: rel,
								line: lineOf(arg),
								value: arg.text,
								why: `call:${callee}:not-copy`,
							});
					}
				}
			}

			// 5. `x.title = "…"` and friends — only on a plain property access, so a nullish chain or a
			//    call never gets a `t(…)` spliced into its left-hand side.
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				node.right &&
				ts.isStringLiteral(node.right) &&
				ts.isPropertyAccessExpression(node.left) &&
				/(?:title|label|ariaLabel|placeholder|message|description|text)/.test(node.left.name.text)
			) {
				const left = node.left.getText(sf);
				if (!insideT(node.right) && looksLikeCopy(node.right.text))
					push(node.right, `t(${quote(node.right.text)})`, `assign:${left}`, node.right.text);
			}

			ts.forEachChild(node, visit);
		};
		visit(sf);

		if (edits.length === 0) continue;
		for (const e of edits) report.push({ file: rel, line: 0, kind: e.kind, value: e.value });

		if (shouldWrite) {
			// Apply back-to-front so earlier offsets stay valid.
			edits.sort((a, b) => b.start - a.start);
			let out = source;
			for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
			if (!/\bt\b[\s\S]*from ["']@\/i18n["']/.test(out)) {
				const anchor = /^import .*;\n/m.exec(out);
				const importLine = 'import { t } from "@/i18n";\n';
				out = anchor
					? out.slice(0, anchor.index) + importLine + out.slice(anchor.index)
					: importLine + out;
			}
			writeFileSync(file, out);
			filesWritten++;
			totalEdits += edits.length;
		}
	}
}

const byKind: Record<string, number> = {};
for (const r of report) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log(JSON.stringify({ edits: report.length, byKind, filesWritten, totalEdits }, null, 1));
console.log("skipped:", skipped.length);
if (!shouldWrite) {
	for (const r of report) console.log(`${r.kind}\t${r.value.slice(0, 100)}`);
}
