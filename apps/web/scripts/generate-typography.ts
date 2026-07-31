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
import { GENERATED_PATH, loadTypography, renderCss, validate } from "./typography";

const check = process.argv.includes("--check");
const typography = loadTypography();

const errors = validate(typography);
if (errors.length > 0) {
	console.error(`typography: invalid source (${errors.length})`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

const css = renderCss(typography);
const shown = relative(process.cwd(), GENERATED_PATH);

if (check) {
	const current = existsSync(GENERATED_PATH) ? readFileSync(GENERATED_PATH, "utf8") : "";
	if (current !== css) {
		console.error(
			`typography: ${shown} is STALE — run \`bun run typography:generate\` and commit it.`,
		);
		process.exit(1);
	}
	console.log(`typography: ${shown} is up to date (v${typography.metadata.version})`);
} else {
	mkdirSync(dirname(GENERATED_PATH), { recursive: true });
	writeFileSync(GENERATED_PATH, css);
	console.log(`typography: wrote ${shown} (v${typography.metadata.version})`);
}
