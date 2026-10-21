import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderReachViolations } from "./i18nRenderReach";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(app: string, extra: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-render-reach-"));
	roots.push(root);
	const write = (path: string, content: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	write(
		"packages/locales/src/react.tsx",
		"export const t = (key: string) => key;\nexport function currentLocale() { return 'en'; }\nexport type Translator = (key: string) => string;\nexport function useT(): Translator { return t; }\nexport function currentTranslator(): Translator { return t; }\n",
	);
	write(
		"app/tsconfig.json",
		JSON.stringify({
			compilerOptions: { jsx: "preserve", strict: true, noEmit: true },
			include: ["src"],
		}),
	);
	write("app/src/app.tsx", app);
	for (const [path, content] of Object.entries(extra)) write(`app/src/${path}`, content);
	return root;
}

const texts = (app: string, extra: Record<string, string> = {}) =>
	renderReachViolations(fixture(app, extra), ["app/tsconfig.json"])
		.filter((v) => v.file.endsWith("app.tsx"))
		.map((v) => `${v.line}:${v.text}`);

test("flags render-time global reads, translating helpers, selectors and getters", () => {
	const app = [
		'import { t, currentLocale, useT, type Translator } from "../../packages/locales/src/react";',
		"declare function useAppStore<T>(selector: (state: number) => T): T;",
		"function label(kind: string) { return t(kind); }",
		"function wrapped(kind: string) { return label(kind); }",
		"function select(state: number) { return t(String(state)); }",
		"export const LABELS = { get one() { return t('one'); } };",
		"function ok(translate: Translator, kind: string) { return translate(kind); }",
		"export function Row({ kind }: { kind: string }) {",
		"  const translate = useT();",
		"  const a = wrapped(kind);",
		"  const b = useAppStore(select);",
		"  const c = [kind].map((k) => t(k));",
		"  const d = new Date().toLocaleString(currentLocale());",
		"  const e = ok(translate, kind);",
		"  const onClick = () => alert(t('later'));",
		"  return [a, b, c, d, e, onClick];",
		"}",
	].join("\n");
	expect(texts(app)).toEqual([
		"6:translating getter",
		"10:wrapped",
		"11:select",
		"12:t",
		"13:currentLocale",
	]);
});

test("catches the reviewed bypasses: currentTranslator, defaults, classes, render props, module load, namespaces, summaries", () => {
	const helpers = [
		'import { t } from "../../packages/locales/src/react";',
		"export function describe(kind: string) { return t(kind); }",
	].join("\n");
	const app = [
		'import { t, currentTranslator, useT } from "../../packages/locales/src/react";',
		'import * as helpers from "./helpers";',
		"declare const React: { Component: new () => object };",
		"function withDefault(kind: string, label = t(kind)) { return label; }",
		"export const TITLE = t('title');",
		"export const options = { summary: () => t('summary') };",
		"export class Legacy extends React.Component { render() { return t('legacy'); } }",
		"declare function List(props: { children: (item: string) => string; send: () => void }): null;",
		"export function View({ kind }: { kind: string }) {",
		"  const a = currentTranslator()(kind);",
		"  const b = withDefault(kind);",
		"  const c = helpers.describe(kind);",
		"  const translate = useT();",
		"  return [a, b, c, translate, <List send={() => t('later')}>{(item) => t(item)}</List>];",
		"}",
	].join("\n");
	expect(texts(app, { "helpers.ts": helpers })).toEqual([
		"5:t",
		"6:summary reads the global translator",
		"7:t",
		"10:currentTranslator",
		"11:withDefault",
		"12:describe",
		"14:t",
	]);
});

test("normalizes namespace callables and named summaries", () => {
	const helpers = [
		'import { t } from "../../packages/locales/src/react";',
		"export function label(kind?: unknown) { return t(String(kind)); }",
	].join("\n");
	const app = [
		'import * as helpers from "./helpers";',
		"import { label } from './helpers';",
		"export const TITLE = helpers.label();",
		"export const named = { summary: label };",
		"export const inline = { summary: helpers.label };",
		"export function View() {",
		"  return [0].map(helpers.label);",
		"}",
	].join("\n");
	expect(texts(app, { "helpers.ts": helpers })).toEqual([
		"3:label",
		"4:summary reads the global translator",
		"5:summary reads the global translator",
		"7:label",
	]);
});
