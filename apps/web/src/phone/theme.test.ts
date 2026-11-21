import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { deviceThemeId } from "./theme";

test("a device preference names a bundled theme, following the OS appearance while System", () => {
	expect(deviceThemeId({ theme: "system", contrast: "normal" }, "light")).toBe("light");
	expect(deviceThemeId({ theme: "system", contrast: "high" }, "dark")).toBe("high-contrast-dark");
	expect(deviceThemeId({ theme: "dark", contrast: "normal" }, "light")).toBe("dark");
	const bundled = new Set(
		readdirSync(new URL("../../../../packages/design-tokens/themes", import.meta.url)).map((file) =>
			file.replace(".theme.json", ""),
		),
	);
	for (const theme of ["system", "light", "dark"] as const)
		for (const contrast of ["normal", "high"] as const)
			for (const system of ["light", "dark"] as const)
				expect(bundled.has(deviceThemeId({ theme, contrast }, system))).toBe(true);
});
