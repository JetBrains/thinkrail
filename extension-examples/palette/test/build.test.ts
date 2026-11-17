import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import packageJson from "../package.json" with { type: "json" };

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SDK = dirname(
	createRequire(import.meta.url).resolve("@thinkrail/extension-sdk/package.json"),
);
const SHARED = JSON.parse(readFileSync(join(SDK, "assets/shared-modules.json"), "utf8")) as {
	api: string;
	modules: Record<string, string[]>;
};

interface WebHalf {
	name: string;
	toolRenderers: Record<
		string,
		{
			renderer: (props: Record<string, unknown>) => React.ReactNode;
			options?: { summary?: (props: { args: Record<string, unknown> }) => string };
		}
	>;
}

let bundle = "";
let stylesheet = "";

beforeAll(() => {
	const command = packageJson.scripts.build.split(" ");
	expect(command.slice(0, 2)).toEqual(["thinkrail-extension", "build"]);
	const result = Bun.spawnSync(
		[process.execPath, join(SDK, "bin/thinkrail-extension.js"), ...command.slice(1)],
		{
			cwd: ROOT,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	bundle = readFileSync(join(ROOT, packageJson.thinkrail.web), "utf8");
	stylesheet = readFileSync(join(ROOT, packageJson.thinkrail.styles), "utf8");
});

function Stand(props: Record<string, unknown>) {
	const { label, children, icon: _icon, iconLeft: _iconLeft, ...rest } = props;
	return jsxRuntime.jsx("button", {
		"aria-label": typeof label === "string" ? label : undefined,
		"data-size": rest.size,
		children: children as React.ReactNode,
	});
}

function host() {
	const asText = (value: unknown) => (typeof value === "string" ? value : "");
	return {
		api: "1.0",
		modules: {
			react: React,
			"react/jsx-runtime": jsxRuntime,
			"react-dom": {},
			"@thinkrail/extension-sdk/web": {
				defineWebExtension: (extension: unknown) => extension,
				strArg: (args: Record<string, unknown>, key: string) => asText(args[key]),
				resultText: (result: unknown) => asText(result),
			},
			"@thinkrail/extension-sdk/ui/button": { Button: Stand, IconButton: Stand },
			"@thinkrail/extension-sdk/ui/utils": {
				cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
			},
		},
	};
}

describe("the palette extension as built by the SDK", () => {
	it("declares the manifest ThinkRail loads", () => {
		expect(packageJson.keywords).toContain("thinkrail-extension");
		expect(packageJson.thinkrail).toEqual({
			api: SHARED.api,
			server: "./server/index.ts",
			web: "./dist/web.js",
			styles: "./dist/web.css",
			title: "Palette",
		});
		expect(Object.keys(packageJson.peerDependencies).sort()).toEqual([
			"@earendil-works/pi-coding-agent",
			"typebox",
		]);
		expect(Object.keys(packageJson.dependencies)).toEqual(["@thinkrail/extension-sdk"]);
	});

	it("bundles no React, UI kit or SDK code — only lookups on the host", () => {
		expect(bundle).toContain("__thinkrailExtensionHost");
		for (const specifier of [
			"react",
			"react/jsx-runtime",
			"@thinkrail/extension-sdk/web",
			"@thinkrail/extension-sdk/ui/button",
			"@thinkrail/extension-sdk/ui/utils",
		]) {
			expect(bundle).toContain(`\`${specifier}\``);
		}
		for (const forbidden of [
			"react.production",
			"Symbol.for(",
			"jsxDEV",
			"tailwind-merge",
			"radix",
		]) {
			expect(bundle).not.toContain(forbidden);
		}
		expect(bundle).not.toMatch(/^import |\simport\s*\(/m);
		expect(bundle.length).toBeLessThan(16_000);
	});

	it("styles only its own prefixed utilities, pointing at the app's variables", () => {
		const selectors = [...stylesheet.matchAll(/(?:^|[{};])\s*([^{};@]+)\{/g)].map(
			(match) => match[1] ?? "",
		);
		const classes = selectors.flatMap((selector) =>
			[...selector.matchAll(/\.((?:\\.|[\w-])+)/g)].map((match) => match[1] ?? ""),
		);
		expect(classes).toContain("palette\\:grid-cols-5");
		for (const name of classes) expect(name).toStartWith("palette\\:");
		expect(stylesheet).toContain("color:var(--text-muted)");
		expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	});

	it("renders the card on the host's React and components", async () => {
		Reflect.set(globalThis, "__thinkrailExtensionHost", host());
		const loaded = (await import(pathToFileURL(join(ROOT, "dist/web.js")).href)) as {
			default: WebHalf;
		};
		Reflect.deleteProperty(globalThis, "__thinkrailExtensionHost");
		const web = loaded.default;
		expect(web.name).toBe(packageJson.name);
		const entry = web.toolRenderers.color_palette;
		if (!entry) throw new Error("no color_palette renderer");
		const args = { base: "#3b82f6", harmony: "triadic" };
		expect(entry.options?.summary?.({ args })).toBe("triadic palette from #3b82f6");

		const details = {
			base: "#3b82f6",
			harmony: "triadic",
			contrastChecked: true,
			colors: [
				{ hex: "#3b82f6", role: "base", contrast: { text: "black", ratio: 5.71, rating: "AA" } },
				{
					hex: "#f63b82",
					role: "triad +120°",
					contrast: { text: "black", ratio: 4.6, rating: "AA" },
				},
			],
		};
		const html = renderToStaticMarkup(
			React.createElement(entry.renderer, { args, result: { details }, status: "done" }),
		);
		expect(html).toContain('data-testid="palette-card"');
		expect(html).toContain('fill="#3b82f6"');
		expect(html).toContain("5.71:1 AA");
		expect(html).toContain('aria-label="Copy #f63b82"');
		expect(html).toContain("Copy CSS variables");

		const pending = renderToStaticMarkup(
			React.createElement(entry.renderer, { args, result: undefined, status: "running" }),
		);
		expect(pending).toContain("Mixing a palette from #3b82f6");
	});
});
