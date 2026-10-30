#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { type CallExpression, type Node, SyntaxKind } from "tsrs/ast";
import {
	isAsExpression,
	isBinaryExpression,
	isCallExpression,
	isConditionalExpression,
	isIdentifier,
	isJsxAttribute,
	isJsxElement,
	isJsxExpression,
	isJsxFragment,
	isJsxText,
	isNoSubstitutionTemplateLiteral,
	isParenthesizedExpression,
	isPropertyAccessExpression,
	isPropertyAssignment,
	isStringLiteral,
	isTemplateExpression,
	isTemplateHead,
	isTemplateMiddle,
	isTemplateTail,
} from "tsrs/ast/is";
import { API, ScriptKind } from "tsrs/async";
import { renderReachViolations } from "./i18nRenderReach";

export const I18N_ROOTS = [
	"apps/web/src",
	"packages/ui",
	"packages/resource-renderers/src",
	"thinkrail-extensions",
] as const;

const SKIPPED_DIRECTORIES = new Set(["node_modules", "generated", "dist", "server", "scripts"]);

const TEXT_ATTRIBUTES = new Set([
	"alt",
	"aria-description",
	"aria-label",
	"aria-placeholder",
	"aria-roledescription",
	"aria-valuetext",
	"caption",
	"description",
	"detail",
	"heading",
	"hint",
	"label",
	"message",
	"placeholder",
	"subtitle",
	"title",
	"tooltip",
]);

const TEXT_ATTRIBUTE_SUFFIX =
	/(?:Label|Text|Title|Description|Message|Placeholder|Hint|Tooltip|Heading|Caption|Subtitle)$/;

const TEXT_PROPERTIES = new Set([
	"caption",
	"description",
	"detail",
	"heading",
	"hint",
	"label",
	"message",
	"placeholder",
	"reason",
	"subtitle",
	"title",
	"tooltip",
]);

const ALLOWED_TEXT = new Set(["ThinkRail"]);

const WORD = /\p{L}{2,}/u;

function isTextAttribute(name: string): boolean {
	return TEXT_ATTRIBUTES.has(name) || TEXT_ATTRIBUTE_SUFFIX.test(name);
}

function hasLetters(text: string): boolean {
	const word = text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
	return WORD.test(word) && !ALLOWED_TEXT.has(word);
}

function looksLikeProse(text: string): boolean {
	const trimmed = text.trim();
	return hasLetters(trimmed) && (/\s/.test(trimmed) || /^\p{Lu}\p{Ll}/u.test(trimmed));
}

function literalParts(node: Node): Node[] {
	if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return [node];
	if (isTemplateExpression(node)) {
		return [node.head, ...node.templateSpans.map((span) => span.literal)];
	}
	if (isParenthesizedExpression(node) || isAsExpression(node)) {
		return literalParts(node.expression);
	}
	if (isConditionalExpression(node)) {
		return [...literalParts(node.whenTrue), ...literalParts(node.whenFalse)];
	}
	if (isBinaryExpression(node)) {
		const kind = node.operatorToken.kind;
		if (
			kind === SyntaxKind.PlusToken ||
			kind === SyntaxKind.BarBarToken ||
			kind === SyntaxKind.QuestionQuestionToken
		) {
			return [...literalParts(node.left), ...literalParts(node.right)];
		}
		if (kind === SyntaxKind.AmpersandAmpersandToken) return literalParts(node.right);
	}
	return [];
}

function literalText(node: Node): string {
	if (
		isStringLiteral(node) ||
		isNoSubstitutionTemplateLiteral(node) ||
		isTemplateHead(node) ||
		isTemplateMiddle(node) ||
		isTemplateTail(node)
	) {
		return node.text;
	}
	return "";
}

function isToastCall(node: CallExpression): boolean {
	const callee = node.expression;
	return (
		isPropertyAccessExpression(callee) &&
		isIdentifier(callee.expression) &&
		callee.expression.text === "toast"
	);
}

function isErrorTextCall(node: CallExpression): boolean {
	return isIdentifier(node.expression) && node.expression.text === "errorText";
}

export interface I18nViolation {
	file: string;
	line: number;
	text: string;
}

export async function sourceViolations(
	api: API,
	path: string,
	source: string,
): Promise<Omit<I18nViolation, "file">[]> {
	const retained = await api.createSourceFile(path, source, {
		scriptKind: path.endsWith("x") ? ScriptKind.TSX : ScriptKind.TS,
	});
	const { sourceFile } = retained;
	const found: Omit<I18nViolation, "file">[] = [];
	const report = (node: Node, text: string) => {
		const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		found.push({ line: line + 1, text: text.trim().replace(/\s+/g, " ").slice(0, 80) });
	};
	const reportParts = (node: Node, test: (text: string) => boolean) => {
		for (const part of literalParts(node)) {
			const text = literalText(part);
			if (test(text)) report(part, text);
		}
	};
	const visit = (node: Node): void => {
		if (isJsxText(node)) {
			if (hasLetters(node.text)) report(node, node.text);
		} else if (isJsxAttribute(node)) {
			const name = node.name.getText(sourceFile);
			const value = node.initializer;
			if (value && isTextAttribute(name)) {
				if (isStringLiteral(value)) {
					if (hasLetters(value.text)) report(value, value.text);
				} else if (isJsxExpression(value) && value.expression) {
					reportParts(value.expression, hasLetters);
				}
			}
		} else if (
			isJsxExpression(node) &&
			node.expression &&
			(isJsxElement(node.parent) || isJsxFragment(node.parent))
		) {
			reportParts(node.expression, hasLetters);
		} else if (isPropertyAssignment(node)) {
			const name = isIdentifier(node.name) || isStringLiteral(node.name) ? node.name.text : "";
			if (TEXT_PROPERTIES.has(name)) reportParts(node.initializer, looksLikeProse);
		} else if (isCallExpression(node)) {
			if (isToastCall(node) && node.arguments[0]) reportParts(node.arguments[0], hasLetters);
			if (isErrorTextCall(node) && node.arguments[1]) reportParts(node.arguments[1], hasLetters);
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	await retained.dispose();
	return found;
}

function sourceFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	const walk = (dir: string, inExtension: boolean) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
				walk(path, inExtension);
			} else if (
				/\.(?:ts|tsx)$/.test(entry.name) &&
				!/\.(?:test|spec)\.tsx?$/.test(entry.name) &&
				!entry.name.endsWith(".d.ts") &&
				(!inExtension || path.split(sep).includes("web"))
			) {
				files.push(path);
			}
		}
	};
	walk(root, root.endsWith("thinkrail-extensions"));
	return files;
}

export async function i18nViolations(api: API, repoRoot: string): Promise<I18nViolation[]> {
	const root = resolve(repoRoot);
	const violations: I18nViolation[] = [];
	for (const path of I18N_ROOTS.flatMap((dir) => sourceFiles(join(root, dir)))) {
		const file = relative(root, path).split(sep).join("/");
		for (const violation of await sourceViolations(api, path, readFileSync(path, "utf8")))
			violations.push({ file, ...violation });
	}
	return violations;
}

const KEY_CONSUMER_ROOTS = [...I18N_ROOTS, "apps/desktop/src", "packages/locales/src"] as const;
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;

export function catalogProblems(catalogText: string, sources: readonly string[]): string[] {
	const catalog = JSON.parse(catalogText) as Record<string, unknown>;
	const keys = Object.keys(catalog);
	const problems: string[] = [];
	const sorted = [...keys].sort();
	if (keys.some((key, index) => key !== sorted[index]))
		problems.push("en.json keys are not sorted");
	for (const [key, value] of Object.entries(catalog)) {
		if (typeof value !== "string" || value.length === 0)
			problems.push(`${key}: not a non-empty string`);
	}
	const corpus = sources.join("\n");
	for (const key of keys) {
		const base = key.replace(PLURAL_SUFFIX, "");
		if (!corpus.includes(`"${base}"`) && !corpus.includes(`'${base}'`)) {
			problems.push(`${key}: not referenced by any source`);
		}
	}
	return problems;
}

function consumerSources(root: string): string[] {
	return KEY_CONSUMER_ROOTS.flatMap((dir) => {
		const absolute = join(root, dir);
		if (!existsSync(absolute)) return [];
		const files: string[] = [];
		const walk = (path: string) => {
			for (const entry of readdirSync(path, { withFileTypes: true })) {
				const child = join(path, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(child);
				} else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name)) {
					files.push(readFileSync(child, "utf8"));
				}
			}
		};
		walk(absolute);
		return files;
	});
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const api = new API({ cwd: root });
	const scan = async () => ({
		violations: await i18nViolations(api, root),
		stale: await renderReachViolations(api, root, ["apps/web/tsconfig.json"]),
	});
	const { violations, stale } = await scan().finally(() => api.close());
	const problems = catalogProblems(
		readFileSync(join(root, "packages/locales/en.json"), "utf8"),
		consumerSources(root),
	);
	if (violations.length > 0) {
		console.error("Hardcoded UI text (use a key from packages/locales/en.json via useT/<T>):");
		for (const v of violations) console.error(`  ${v.file}:${v.line}  ${JSON.stringify(v.text)}`);
		console.error(`\n${violations.length} hardcoded string(s).`);
	}
	if (problems.length > 0) {
		console.error("packages/locales/en.json:");
		for (const problem of problems) console.error(`  ${problem}`);
	}
	if (stale.length > 0) {
		console.error(
			"Render-time reads of the global translator (pass useT()'s translator; see packages/locales/SPEC.md):",
		);
		for (const v of stale) console.error(`  ${v.file}:${v.line}  ${v.text}`);
	}
	if (violations.length > 0 || problems.length > 0 || stale.length > 0) process.exitCode = 1;
	else
		console.log(
			"check-i18n: OK (no hardcoded UI text; catalog sorted and fully referenced; no render-time global translator)",
		);
}
