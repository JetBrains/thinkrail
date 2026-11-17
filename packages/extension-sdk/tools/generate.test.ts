import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	EXTENSION_API_VERSION,
	SDK_PACKAGE,
	SHARED_SPECIFIERS,
	type SharedModulesManifest,
} from "../src/shared";
import { MANIFEST_FILE, THEME_FILE, themeCss } from "./generate";

const committed = JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as SharedModulesManifest;
const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { exports: Record<string, unknown> };

describe("generated assets stay in step with the app", () => {
	it("the committed export manifest matches the production modules", () => {
		const result = Bun.spawnSync(["bun", "tools/generate.ts", "--check"], {
			cwd: fileURLToPath(new URL("..", import.meta.url)),
			env: { ...process.env, NODE_ENV: "production" },
			stderr: "pipe",
		});
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	});

	it("the committed theme matches the app's style sources", () => {
		expect(readFileSync(THEME_FILE, "utf8")).toBe(themeCss());
	});

	it("the theme maps the semantic colours, the 1px spacing scale and the radius scale", () => {
		const theme = readFileSync(THEME_FILE, "utf8");
		expect(theme).toContain("--color-*: initial;");
		expect(theme).toContain("--spacing: 1px;");
		expect(theme).toContain("--radius-sm: 4px;");
		expect(theme).not.toContain("@theme static");
		expect(theme).not.toContain("@import");
		expect(theme).not.toMatch(/:root\s*\{/);
	});
});

describe("the shared-specifier list", () => {
	it("is exactly the manifest's modules, for the current API", () => {
		expect(committed.api).toBe(EXTENSION_API_VERSION);
		expect(Object.keys(committed.modules).sort()).toEqual([...SHARED_SPECIFIERS].sort());
	});

	it("gives every SDK specifier a package export", () => {
		const sdkSubpaths = SHARED_SPECIFIERS.filter((specifier) =>
			specifier.startsWith(`${SDK_PACKAGE}/`),
		).map((specifier) => `.${specifier.slice(SDK_PACKAGE.length)}`);
		for (const subpath of [...sdkSubpaths, "./server"])
			expect(packageJson.exports[subpath]).toBeDefined();
	});
});
