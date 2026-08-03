#!/usr/bin/env bun
/**
 * Writes `src/styles/generated/colors.css` from `src/styles/colors.json`.
 *
 *   bun run colors:generate          write the files
 *   bun run colors:generate --check  fail if a committed file is stale (CI + pre-commit gate)
 *
 * The generated output is committed so every colour change is reviewable as a diff — the same
 * arrangement `generate-typography.ts` uses for type.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { type Colors, GENERATED_CSS_PATH, loadColors, renderCss, validate } from "./colors";

const check = process.argv.includes("--check");
const colors: Colors = loadColors();

const errors = validate(colors);
if (errors.length > 0) {
	console.error(`colors: invalid source (${errors.length})`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

const outputs = [{ path: GENERATED_CSS_PATH, content: renderCss(colors) }];

if (check) {
	const stale = outputs.filter(
		({ path, content }) => (existsSync(path) ? readFileSync(path, "utf8") : "") !== content,
	);
	if (stale.length > 0) {
		for (const { path } of stale) {
			console.error(`colors: ${relative(process.cwd(), path)} is STALE`);
		}
		console.error("Run `bun run colors:generate` and commit the result.");
		process.exit(1);
	}
	console.log(`colors: generated output is up to date (v${colors.metadata.version})`);
} else {
	for (const { path, content } of outputs) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		console.log(`colors: wrote ${relative(process.cwd(), path)}`);
	}
}
