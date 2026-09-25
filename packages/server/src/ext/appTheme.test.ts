import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OUTPUT, renderAppTheme } from "../../scripts/generate-ext-theme";

test("the extension theme matches apps/web's @theme blocks (run ext-theme:generate)", () => {
	expect(readFileSync(OUTPUT, "utf8")).toBe(renderAppTheme());
});
