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
import { type Colors, GENERATED_CSS_PATH, loadColors, renderCss, validate } from "./colors";
import { writeOrCheck } from "./generatedFiles";

const colors: Colors = loadColors();

const errors = validate(colors);
if (errors.length > 0) {
	console.error(`colors: invalid source (${errors.length})`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

writeOrCheck({
	label: "colors",
	version: colors.metadata.version,
	check: process.argv.includes("--check"),
	outputs: [{ path: GENERATED_CSS_PATH, content: renderCss(colors) }],
});
