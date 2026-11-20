import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HOST_OBJECT, type SharedModulesManifest } from "../shared";
import { buildExtension, ExtensionBuildError } from ".";
import { bundledImports } from "./bundle";
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

const NODE_DEPENDENCY = {
	"node_modules/node-dep/package.json": JSON.stringify({
		name: "node-dep",
		type: "module",
		main: "index.js",
	}),
	"node_modules/node-dep/index.js":
		'import { readFileSync } from "node:fs";\nimport path from "path";\nexport const label = "node-dep";\nexport function read(file) { return readFileSync(path.join("/", file), "utf8"); }\n',
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
		expect(bundledImports(bundle)).toEqual([]);
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

	const SDK_UI =
		"@thinkrail/extension-sdk/ui/button, @thinkrail/extension-sdk/ui/theme, @thinkrail/extension-sdk/ui/utils";
	const SDK_ALL = `@thinkrail/extension-sdk/web, @thinkrail/extension-sdk/resources, ${SDK_UI}`;
	const BRING_OWN = `is not part of extension API 1.0: the extension must bring its own (a dependency it bundles, or its own code). The shared UI modules are ${SDK_UI}.`;

	it.each([
		[
			"@thinkrail/ui/button",
			"@thinkrail/ui/button is private to the ThinkRail repository; import @thinkrail/extension-sdk/ui/button instead.",
		],
		[
			"@thinkrail/resource-renderers",
			"@thinkrail/resource-renderers is private to the ThinkRail repository; import @thinkrail/extension-sdk/resources instead.",
		],
		[
			"@thinkrail/ui/dialog",
			`@thinkrail/ui/dialog is private to the ThinkRail repository, and @thinkrail/extension-sdk/ui/dialog ${BRING_OWN}`,
		],
		[
			"@thinkrail/ui/made-up",
			`@thinkrail/ui/made-up is private to the ThinkRail repository, and @thinkrail/extension-sdk/ui/made-up ${BRING_OWN}`,
		],
		["@thinkrail/extension-sdk/ui/dialog", `@thinkrail/extension-sdk/ui/dialog ${BRING_OWN}`],
		[
			"@thinkrail/extension-sdk/charts",
			`@thinkrail/extension-sdk/charts is not part of extension API 1.0. The web half may import: ${SDK_ALL}.`,
		],
		[
			"@thinkrail/extension-api/server",
			"@thinkrail/extension-api/server is private to the ThinkRail repository, and @thinkrail/extension-sdk/server belongs to the server half; the web half cannot import it.",
		],
		[
			"@thinkrail/extension-api/installed",
			`@thinkrail/extension-api/installed is private to the ThinkRail repository and not part of extension API 1.0. The web half may import: ${SDK_ALL}.`,
		],
	])("derives the hint for %s from the shared modules", async (specifier, reason) => {
		const { root } = setup({
			"web/index.tsx": `import * as forbidden from ${JSON.stringify(specifier)};\nexport default forbidden;\n`,
		});
		expect(await buildFails(root)).toBe(`${reason} (imported by web/index.tsx)`);
	});

	const REACT_DOM =
		"browser, createPortal, flushSync, preconnect, prefetchDNS, preinit, preinitModule, preload, preloadModule, requestFormReset, useFormStatus, version";
	const REACT = sharedModules.modules.react.join(", ");
	const UNLISTED_DEPENDENCY = {
		"node_modules/detecting-dep/package.json": JSON.stringify({
			name: "detecting-dep",
			type: "module",
			main: "index.js",
		}),
		"node_modules/detecting-dep/index.js":
			'import * as React from "react";\nexport const useEvent = React.useEffectEvent ?? React.someUnlistedThing;\n',
	};

	it("names an import outside the allow-list, its module's names and its importer", async () => {
		const { root } = setup({
			"web/index.tsx": 'import "./inner";\nexport default {};\n',
			"web/inner.ts": [
				'import { unstable_batchedUpdates } from "react-dom";',
				'import { Dialog } from "@thinkrail/extension-sdk/ui/button";',
				'import Button from "@thinkrail/extension-sdk/ui/button";',
				"export const kept = [unstable_batchedUpdates, Dialog, Button];",
				"",
			].join("\n"),
		});
		expect(await buildFails(root)).toBe(
			[
				`unstable_batchedUpdates is not part of extension API 1.0: react-dom exports only ${REACT_DOM}. (imported by web/inner.ts)`,
				"Dialog is not part of extension API 1.0: @thinkrail/extension-sdk/ui/button exports only Button, IconButton, withIconClass. (imported by web/inner.ts)",
				"the default export is not part of extension API 1.0: @thinkrail/extension-sdk/ui/button exports only Button, IconButton, withIconClass. (imported by web/inner.ts)",
			].join("\n"),
		);
		expect(existsSync(join(root, "dist/web.js"))).toBe(false);
	});

	it("rejects a named import outside the allow-list made from inside node_modules", async () => {
		const { root } = setup({
			"web/index.tsx": 'import { batch } from "old-dep";\nexport default { batch };\n',
			"node_modules/old-dep/package.json": JSON.stringify({ name: "old-dep", type: "module" }),
			"node_modules/old-dep/index.js":
				'export { unstable_batchedUpdates as batch } from "react-dom";\n',
		});
		expect(await buildFails(root)).toBe(
			`unstable_batchedUpdates is not part of extension API 1.0: react-dom exports only ${REACT_DOM}. (imported by node_modules/old-dep/index.js)`,
		);
	});

	it("rejects a namespace member outside the allow-list the web half reads", async () => {
		const { root } = setup({
			"web/index.tsx":
				'import * as React from "react";\nexport default { state: React.useState, other: React.someUnlistedThing };\n',
		});
		expect(await buildFails(root)).toBe(
			`someUnlistedThing is not part of extension API 1.0: react exports only ${REACT}. (imported by web/index.tsx)`,
		);
		expect(existsSync(join(root, "dist/web.js"))).toBe(false);
	});

	it("only warns about a namespace member a dependency reads, which may be feature detection", async () => {
		const { root } = setup({
			"web/index.tsx": 'import { useEvent } from "detecting-dep";\nexport default { useEvent };\n',
			...UNLISTED_DEPENDENCY,
		});
		const output = await buildExtension({ root, prefix: "fx", assetsDir: ASSETS });
		expect(output.warnings).toEqual([
			`someUnlistedThing is not part of extension API 1.0: react exports only ${REACT}. It is undefined at runtime. (imported by node_modules/detecting-dep/index.js)`,
		]);
	});

	it("builds a default import, whose unlisted members are undefined at runtime", async () => {
		const { root } = setup(
			{
				"web/index.tsx":
					'import React from "react";\nexport default { state: React.useState, other: React.someUnlistedThing };\n',
			},
			{ ...WEB_PACKAGE, thinkrail: { api: "1.0", web: "./dist/web.js" } },
		);
		const output = await buildExtension({ root, assetsDir: ASSETS });
		expect(output.warnings).toEqual([]);
		const host = fakeHost("1.0");
		Reflect.set(globalThis, HOST_OBJECT, host);
		const loaded = (await import(pathToFileURL(join(root, "dist/web.js")).href)) as {
			default: { state: unknown; other: unknown };
		};
		expect(loaded.default.state).toBe(host.modules.react?.useState);
		expect(Object.keys(loaded.default)).toEqual(["state", "other"]);
		expect(loaded.default.other).toBeUndefined();
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

	it("fails on an import of a package that is not installed", async () => {
		const { root } = setup({
			"web/index.tsx": 'import "./inner";\nexport default {};\n',
			"web/inner.ts": 'import { chart } from "@acme/charts/line";\nexport const kept = chart;\n',
		});
		const message = await buildFails(root);
		expect(message).toBe(
			"@acme/charts/line cannot be resolved: install @acme/charts in the extension, or remove the import. (imported by web/inner.ts)",
		);
		expect(existsSync(join(root, "dist/web.js"))).toBe(false);
	});

	it("drops Node built-ins a dependency imports but the web half never uses", async () => {
		const { root } = setup({
			"web/index.tsx": 'import { label } from "node-dep";\nexport default { label };\n',
			...NODE_DEPENDENCY,
		});
		const output = await buildExtension({ root, prefix: "fx", assetsDir: ASSETS });
		expect(output.warnings).toEqual([]);
		expect(bundledImports(readFileSync(join(root, "dist/web.js"), "utf8"))).toEqual([]);
	});

	it("fails on a Node built-in the web half uses", async () => {
		const { root } = setup({
			"web/index.tsx": 'import { read } from "node-dep";\nexport default { read };\n',
			...NODE_DEPENDENCY,
		});
		expect(await buildFails(root)).toBe(
			"node:fs is a Node built-in, which a web half cannot use: remove the import or use a browser alternative. (imported by node_modules/node-dep/index.js)",
		);
		expect(existsSync(join(root, "dist/web.js"))).toBe(false);
	});

	it("finds every import a bundle keeps", () => {
		expect(
			bundledImports(
				'import{a}from"x";import"y";export*from"./z";export{b}from"w";const c=import("v"),d=import(e);',
			),
		).toEqual(["x", "y", "./z", "w", "v"]);
		expect(bundledImports("const text=\"import x from 'y'\";export{text as default};")).toEqual([]);
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
