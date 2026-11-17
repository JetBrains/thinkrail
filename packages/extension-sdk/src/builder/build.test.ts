import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HOST_OBJECT, type SharedModulesManifest } from "../shared";
import { buildExtension, ExtensionBuildError } from ".";
import { ASSETS, type Fixture, fixture, WEB_PACKAGE } from "./testing";

const CARD = `
import { useState } from "react";
import { Button } from "@thinkrail/extension-sdk/ui/button";
import { cn } from "@thinkrail/extension-sdk/ui/utils";
import { defineWebExtension, strArg, type ToolRenderProps } from "@thinkrail/extension-sdk/web";
import { useTick } from "tiny-dep";

function Card(props: ToolRenderProps) {
	const [count, setCount] = useState(0);
	useTick();
	return (
		<div className={cn("fx:p-12 fx:bg-feedback-info-subtle fx:rounded-md", count > 1 && "fx:border")}>
			<Button onClick={() => setCount(count + 1)}>{strArg(props.args, "city")}</Button>
		</div>
	);
}

export default defineWebExtension({
	name: "thinkrail-ext-fixture",
	toolRenderers: { fixture_tool: { renderer: Card, options: { prominence: "primary" } } },
});
`;

const DEPENDENCY = {
	"node_modules/tiny-dep/package.json": JSON.stringify({
		name: "tiny-dep",
		type: "module",
		main: "index.js",
	}),
	"node_modules/tiny-dep/index.js":
		'import React, { useEffect } from "react";\nimport * as Namespace from "react";\nexport function useTick() { useEffect(() => {}, []); return React === Namespace.default; }\n',
};

const sharedModules = JSON.parse(
	readFileSync(new URL("shared-modules.json", ASSETS), "utf8"),
) as SharedModulesManifest;

let current: Fixture | undefined;
afterEach(() => {
	current?.dispose();
	current = undefined;
	Reflect.deleteProperty(globalThis, HOST_OBJECT);
});

function setup(files: Record<string, string>, packageJson: Record<string, unknown> = WEB_PACKAGE) {
	current = fixture(packageJson, files);
	return current;
}

async function buildFails(root: string, prefix = "fx"): Promise<string> {
	try {
		await buildExtension({ root, prefix, assetsDir: ASSETS });
	} catch (error) {
		expect(error).toBeInstanceOf(ExtensionBuildError);
		return (error as Error).message;
	}
	throw new Error("the build succeeded");
}

function fakeHost(api: string) {
	const modules = Object.fromEntries(
		Object.entries(sharedModules.modules).map(([specifier, names]) => [
			specifier,
			Object.fromEntries(names.map((name): [string, unknown] => [name, null])),
		]),
	);
	modules["@thinkrail/extension-sdk/web"] = {
		...modules["@thinkrail/extension-sdk/web"],
		defineWebExtension: (extension: unknown) => extension,
	};
	return { api, modules };
}

describe("thinkrail-extension build", () => {
	it("bundles one ESM file with every shared module read from the host", async () => {
		const { root } = setup({ "web/index.tsx": CARD, ...DEPENDENCY });
		const output = await buildExtension({ root, prefix: "fx", assetsDir: ASSETS });
		expect(output.files.map((file) => file.path)).toEqual(["dist/web.js", "dist/web.css"]);
		expect(output.warnings).toEqual([]);
		const bundle = readFileSync(join(root, "dist/web.js"), "utf8");
		expect(bundle).toContain(HOST_OBJECT);
		for (const forbidden of [
			"react.production",
			'Symbol.for("react.',
			"Symbol.for(`react.",
			"jsxDEV",
			"radix",
			"tailwind-merge",
			"class-variance-authority",
			"import ",
		]) {
			expect(bundle).not.toContain(forbidden);
		}
	});

	it("emits only prefixed utilities pointing at the app's variables", async () => {
		const { root } = setup({ "web/index.tsx": CARD, ...DEPENDENCY });
		await buildExtension({ root, prefix: "fx", assetsDir: ASSETS });
		const css = readFileSync(join(root, "dist/web.css"), "utf8");
		const selectors = [...css.matchAll(/(?:^|[{};])\s*([^{};@]+)\{/g)].map(
			(match) => match[1] ?? "",
		);
		const classes = selectors.flatMap((selector) =>
			[...selector.matchAll(/\.((?:\\.|[\w-])+)/g)].map((match) => match[1]),
		);
		expect(classes.length).toBeGreaterThan(0);
		for (const name of classes) expect(name).toStartWith("fx\\:");
		expect(css).toContain("var(--feedback-info-subtle)");
		expect(css).toContain("padding:12px");
		expect(css).not.toContain("preflight");
		expect(css).not.toMatch(/(?:^|[}\s])(?:html|body|\*)\s*\{/);
	});

	it("loads inside a host of the same API major and refuses any other", async () => {
		const { root } = setup({ "web/index.tsx": CARD, ...DEPENDENCY });
		await buildExtension({ root, prefix: "fx", assetsDir: ASSETS });
		const copy = (name: string) => {
			const path = join(root, `dist/${name}.js`);
			copyFileSync(join(root, "dist/web.js"), path);
			return pathToFileURL(path).href;
		};
		const missing = copy("missing");
		const major = copy("major");
		const same = copy("same");

		await expect(import(missing)).rejects.toThrow(`globalThis.${HOST_OBJECT} is missing`);
		Reflect.set(globalThis, HOST_OBJECT, fakeHost("2.0"));
		await expect(import(major)).rejects.toThrow(
			"built for extension API 1.0; this ThinkRail provides extension API 2.0",
		);
		Reflect.set(globalThis, HOST_OBJECT, fakeHost("1.3"));
		const loaded = (await import(same)) as {
			default: { name: string; toolRenderers: Record<string, unknown> };
		};
		expect(loaded.default.name).toBe("thinkrail-ext-fixture");
		expect(Object.keys(loaded.default.toolRenderers)).toEqual(["fixture_tool"]);
	});

	it("keeps output readable without minification", async () => {
		const { root } = setup({ "web/index.tsx": CARD, ...DEPENDENCY });
		await buildExtension({ root, prefix: "fx", minify: false, assetsDir: ASSETS });
		expect(readFileSync(join(root, "dist/web.js"), "utf8")).toContain("function Card(props)");
	});

	it("appends the author's own stylesheet", async () => {
		const { root } = setup({
			"web/index.tsx": CARD,
			"web/extra.css": "@utility fx-glow { box-shadow: 0 0 4px var(--primary); }\n",
			...DEPENDENCY,
		});
		await buildExtension({ root, prefix: "fx", css: "web/extra.css", assetsDir: ASSETS });
		expect(readFileSync(join(root, "dist/web.css"), "utf8")).not.toContain("@import");
	});

	it.each([
		["react-dom/client", "never creates its own React root"],
		["react/compiler-runtime", "without the React Compiler"],
		["react-dom/server", "would load a second React"],
		["@thinkrail/extension-sdk/server", "belongs to the server half"],
		["@thinkrail/extension-sdk/ui/popover", "is not part of extension API 1.0"],
		["@thinkrail/ui/button", "import @thinkrail/extension-sdk/ui/button instead"],
		["@thinkrail/extension-api/web", "import @thinkrail/extension-sdk/web instead"],
		["./card.css", "cannot import CSS from JavaScript"],
	])("rejects an import of %s", async (specifier, reason) => {
		const { root } = setup({
			"web/index.tsx": `import "./inner";\nexport default {};\n`,
			"web/inner.ts": `import * as forbidden from ${JSON.stringify(specifier)};\nexport const kept = forbidden;\n`,
		});
		const message = await buildFails(root);
		expect(message).toContain(reason);
		expect(message).toContain("(imported by web/inner.ts)");
	});

	it("rejects a forbidden import made from inside node_modules", async () => {
		const { root } = setup({
			"web/index.tsx": 'import { c } from "compiled-dep";\nexport default c;\n',
			"node_modules/compiled-dep/package.json": JSON.stringify({
				name: "compiled-dep",
				type: "module",
			}),
			"node_modules/compiled-dep/index.js":
				'import { c } from "react/compiler-runtime";\nexport { c };\n',
		});
		expect(await buildFails(root)).toContain("node_modules/compiled-dep/index.js");
	});

	it("requires a valid prefix when the manifest declares styles", async () => {
		const { root } = setup({ "web/index.tsx": CARD, ...DEPENDENCY });
		await expect(buildExtension({ root, assetsDir: ASSETS })).rejects.toThrow(
			"--prefix is required",
		);
		expect(await buildFails(root, "Fx")).toContain("lowercase letters");
		expect(await buildFails(root, "f-x")).toContain("lowercase letters");
	});

	it("builds a web half without styles and ignores the prefix", async () => {
		const { root } = setup(
			{ "web/index.ts": 'export default { name: "x", toolRenderers: {} };\n' },
			{ ...WEB_PACKAGE, thinkrail: { api: "1.0", web: "./out/web.js" } },
		);
		const output = await buildExtension({ root, prefix: "fx", assetsDir: ASSETS });
		expect(output.files.map((file) => file.path)).toEqual(["out/web.js"]);
		expect(output.warnings).toEqual(['--prefix is ignored: the manifest declares no "styles".']);
	});

	it("has nothing to build for a server-only extension", async () => {
		const { root } = setup(
			{ "server/index.ts": "export default {};\n" },
			{
				...WEB_PACKAGE,
				thinkrail: { api: "1.0", server: "./server/index.ts" },
				dependencies: { "@thinkrail/extension-sdk": "1.0.0" },
			},
		);
		const output = await buildExtension({ root, assetsDir: ASSETS });
		expect(output.files).toEqual([]);
		expect(output.warnings).toEqual([]);
	});

	it("explains a missing web entry", async () => {
		const { root } = setup({});
		expect(await buildFails(root)).toContain("looked for web/index.tsx, web/index.ts");
	});
});
