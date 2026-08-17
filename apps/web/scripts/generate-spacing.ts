#!/usr/bin/env bun
/**
 * Writes `src/styles/generated/spacing.css` from `src/styles/spacing.json`.
 *
 *   bun run spacing:generate          write the file
 *   bun run spacing:generate --check  fail if the committed file is stale (CI + pre-commit gate)
 *
 * The generated output is committed so every spacing change is reviewable as a diff — the same
 * arrangement `generate-colors.ts` and `generate-typography.ts` use.
 */
import { writeOrCheck } from "./generatedFiles";
import { GENERATED_PATH, loadSpacing, renderCss, type Spacing, validate } from "./spacing";

const spacing: Spacing = loadSpacing();

const errors = validate(spacing);
if (errors.length > 0) {
	console.error(`spacing: invalid source (${errors.length})`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

writeOrCheck({
	label: "spacing",
	version: spacing.metadata.version,
	check: process.argv.includes("--check"),
	outputs: [{ path: GENERATED_PATH, content: renderCss(spacing) }],
});
