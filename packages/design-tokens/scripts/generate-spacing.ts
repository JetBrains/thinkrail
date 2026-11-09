#!/usr/bin/env bun
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
