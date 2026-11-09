#!/usr/bin/env bun
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
