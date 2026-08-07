#!/usr/bin/env bun
/**
 * Writes `src/styles/generated/typography.css` from `src/styles/typography.json`.
 *
 *   bun run typography:generate        write the file
 *   bun run typography:generate --check  fail if the committed file is stale (CI + pre-commit gate)
 *
 * The generated CSS is committed so every typography change is reviewable as a diff.
 */
import { writeOrCheck } from "./generatedFiles";
import {
	GENERATED_FONTS_PATH,
	GENERATED_PATH,
	loadTypography,
	renderCss,
	renderFontsCss,
	validate,
} from "./typography";

const typography = loadTypography();

const errors = validate(typography);
if (errors.length > 0) {
	console.error(`typography: invalid source (${errors.length})`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

writeOrCheck({
	label: "typography",
	version: typography.metadata.version,
	check: process.argv.includes("--check"),
	outputs: [
		{ path: GENERATED_PATH, content: renderCss(typography) },
		{ path: GENERATED_FONTS_PATH, content: renderFontsCss(typography) },
	],
});
