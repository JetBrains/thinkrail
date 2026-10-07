import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registryInlineExtensions, resolveExtensionSkillRoots, serverExtensions } from "./index";

describe("server extension registry", () => {
	it("lists visualize with its public server specifier bound to the imported descriptor", async () => {
		const specifiers = serverExtensions.map((entry) => entry.specifier);
		expect(specifiers).toEqual(["@thinkrail/ext-visualize/server"]);
		expect(new Set(specifiers).size).toBe(specifiers.length);
		for (const entry of serverExtensions) {
			const resolved = createRequire(import.meta.url).resolve(entry.specifier);
			const loaded = (await import(resolved)) as { default: unknown };
			expect(loaded.default).toBe(entry.extension);
			expect(entry.extension.name).toBe("visualize");
		}
	});

	it("flattens parent and child factories into named inline extensions", () => {
		const parents = registryInlineExtensions("extensions");
		expect(parents.map((inline) => (typeof inline === "function" ? "fn" : inline.name))).toEqual([
			"visualize",
		]);
		expect(registryInlineExtensions("childExtensions")).toEqual([]);
	});
});

describe("resolveExtensionSkillRoots", () => {
	function fixture(): { root: string; entry: string } {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "thinkrail-ext-skills-")));
		const extensionDir = join(root, "node_modules", "@acme", "ext-demo");
		const entry = join(extensionDir, "server", "index.ts");
		mkdirSync(join(extensionDir, "server"), { recursive: true });
		writeFileSync(entry, "export default {};\n");
		const skillPackage = join(extensionDir, "node_modules", "@acme", "pi-demo");
		mkdirSync(join(skillPackage, "skills", "demo"), { recursive: true });
		mkdirSync(join(skillPackage, "more-skills"), { recursive: true });
		writeFileSync(
			join(skillPackage, "package.json"),
			JSON.stringify({
				name: "@acme/pi-demo",
				exports: { ".": "./index.ts", "./package.json": "./package.json" },
				pi: { skills: ["./skills", "./more-skills"] },
			}),
		);
		const bare = join(extensionDir, "node_modules", "no-skills");
		mkdirSync(bare, { recursive: true });
		writeFileSync(join(bare, "package.json"), JSON.stringify({ name: "no-skills" }));
		return { root, entry };
	}

	it("resolves pi.skills directories from the extension's own dependency graph", () => {
		const { root, entry } = fixture();
		try {
			const roots = resolveExtensionSkillRoots({
				specifier: entry,
				extension: { name: "demo", extensions: [], skillPackages: ["@acme/pi-demo"] },
			});
			const skillPackage = join(root, "node_modules", "@acme", "ext-demo", "node_modules", "@acme");
			expect(roots).toEqual([
				join(skillPackage, "pi-demo", "skills"),
				join(skillPackage, "pi-demo", "more-skills"),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns nothing for an extension without skill packages and never resolves its entry", () => {
		expect(
			resolveExtensionSkillRoots({
				specifier: "@acme/missing/server",
				extension: { name: "quiet", extensions: [] },
			}),
		).toEqual([]);
	});

	it("fails loudly for a named package that declares no skills", () => {
		const { root, entry } = fixture();
		try {
			expect(() =>
				resolveExtensionSkillRoots({
					specifier: entry,
					extension: { name: "demo", extensions: [], skillPackages: ["no-skills"] },
				}),
			).toThrow(/no-skills declares no pi\.skills/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resolves the shipped registry without error", () => {
		for (const entry of serverExtensions) {
			expect(() => resolveExtensionSkillRoots(entry)).not.toThrow();
		}
	});
});
