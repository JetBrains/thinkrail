import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	OUTPUT,
	renderAppTheme,
	renderThemeTokens,
	TOKENS_OUTPUT,
} from "../../scripts/generate-ext-theme";

test("the extension theme matches apps/web's @theme blocks (run ext-theme:generate)", () => {
	expect(readFileSync(OUTPUT, "utf8")).toBe(renderAppTheme());
});

test("the extension theme tokens match apps/web's token sources (run ext-theme:generate)", () => {
	expect(readFileSync(TOKENS_OUTPUT, "utf8")).toBe(renderThemeTokens());
});
