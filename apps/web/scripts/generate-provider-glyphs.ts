#!/usr/bin/env bun
import { writeOrCheck } from "./generatedFiles";
import { GENERATED_GLYPHS_PATH, renderGlyphsModule } from "./providerGlyphs";

writeOrCheck({
	label: "provider-glyphs",
	version: "1",
	check: process.argv.includes("--check"),
	outputs: [{ path: GENERATED_GLYPHS_PATH, content: renderGlyphsModule() }],
});
