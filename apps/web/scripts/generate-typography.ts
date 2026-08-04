#!/usr/bin/env bun
/**
 * Writes `src/styles/generated/typography.css` from `src/styles/typography.json`.
 *
 *   bun run typography:generate        write the file
 *   bun run typography:generate --check  fail if the committed file is stale (CI + pre-commit gate)
 *
 * The generated CSS is committed so every typography change is reviewable as a diff.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import {
	GENERATED_FONTS_PATH,
	GENERATED_PATH,
	loadTypography,
	renderCss,
	renderFontsCss,
	validate,
} from "./typography";

const check = process.argv.includes("--check");
const typography = loadTypography();

const errors = validate(typography);
if (errors.length > 0) {
	console.error(`typography: invalid source (${errors.length})`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

const outputs = [
	{ path: GENERATED_PATH, content: renderCss(typography) },
	{ path: GENERATED_FONTS_PATH, content: renderFontsCss(typography) },
];

if (check) {
	const stale = outputs.filter(
		({ path, content }) => (existsSync(path) ? readFileSync(path, "utf8") : "") !== content,
	);
	if (stale.length > 0) {
		for (const { path } of stale) {
			console.error(`typography: ${relative(process.cwd(), path)} is STALE`);
		}
		console.error("Run `bun run typography:generate` and commit the result.");
		process.exit(1);
	}
	console.log(`typography: generated output is up to date (v${typography.metadata.version})`);
} else {
	for (const { path, content } of outputs) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		console.log(`typography: wrote ${relative(process.cwd(), path)}`);
	}
}
