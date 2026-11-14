#!/usr/bin/env bun
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
