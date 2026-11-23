import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHARED_MODULE_EXPORTS } from "@thinkrail/extension-api/installed";
import {
	EXTENSION_API_VERSION,
	SDK_PACKAGE,
	SHARED_SPECIFIERS,
	type SharedModulesManifest,
} from "../src/shared";
import { MANIFEST_FILE, THEME_FILE, themeCss, unlistedPublicNames } from "./generate";
import { WHOLE_PUBLIC_API_EXCEPT } from "./sources";

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
		expect(Object.keys(committed.modules)).toEqual([...SHARED_SPECIFIERS]);
	});

	it("names exactly the app's allow-list", () => {
		expect(JSON.stringify(committed.modules)).toBe(JSON.stringify(SHARED_MODULE_EXPORTS));
	});

	it("gives every SDK specifier a package export, and nothing else", () => {
		const sdkSubpaths = SHARED_SPECIFIERS.filter((specifier) =>
			specifier.startsWith(`${SDK_PACKAGE}/`),
		).map((specifier) => `.${specifier.slice(SDK_PACKAGE.length)}`);
		expect(Object.keys(packageJson.exports).sort()).toEqual(
			[...sdkSubpaths, "./server", "./shared-modules.json", "./theme.css", "./package.json"].sort(),
		);
	});
});

describe("the React specifiers", () => {
	it("allow-list the whole public API save internals, unstable names and the listed exceptions", () => {
		expect(Object.keys(WHOLE_PUBLIC_API_EXCEPT)).toEqual([
			"react",
			"react/jsx-runtime",
			"react-dom",
		]);
		for (const [specifier, leftOut] of Object.entries(WHOLE_PUBLIC_API_EXCEPT)) {
			const listed: readonly string[] =
				SHARED_MODULE_EXPORTS[specifier as keyof typeof SHARED_MODULE_EXPORTS];
			for (const name of leftOut ?? []) expect(listed).not.toContain(name);
		}
	});

	it("name an export the allow-list neither lists nor leaves out", () => {
		const namespace = {
			default: {},
			__CLIENT_INTERNALS: {},
			unstable_batchedUpdates: () => undefined,
			experimental_taint: () => undefined,
			useFormState: () => undefined,
			useState: () => undefined,
			useNewHook: () => undefined,
		};
		expect(unlistedPublicNames(namespace, ["useState"], ["useFormState"])).toEqual(["useNewHook"]);
	});
});
