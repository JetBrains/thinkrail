import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Fixture, fixture, WEB_PACKAGE } from "./builder/testing";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

let current: Fixture | undefined;
afterEach(() => {
	current?.dispose();
	current = undefined;
});

function run(args: string[], cwd: string) {
	const result = Bun.spawnSync(["bun", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	return {
		code: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

describe("thinkrail-extension", () => {
	it("builds the extension in the current folder", () => {
		current = fixture(WEB_PACKAGE, {
			"web/index.tsx": 'export default { name: "x", toolRenderers: {} };\n',
		});
		const result = run(["build", "--prefix", "fx"], current.root);
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("thinkrail-ext-fixture: dist/web.js");
		expect(existsSync(join(current.root, "dist/web.css"))).toBe(true);
	});

	it("reports a build error without a stack trace", () => {
		current = fixture(WEB_PACKAGE, { "web/index.tsx": "export default {};\n" });
		const result = run(["build"], current.root);
		expect(result.code).toBe(1);
		expect(result.stderr).toStartWith("thinkrail-extension: --prefix is required");
		expect(result.stderr).not.toContain("    at ");
	});

	it("exits 2 with usage when an output would overwrite an input, touching nothing", () => {
		current = fixture(
			{ ...WEB_PACKAGE, thinkrail: { api: "1.0", web: "./web/index.js" } },
			{ "web/index.js": 'export default { name: "x", toolRenderers: {} };\n' },
		);
		const result = run(["build", "--entry", "web/index.js"], current.root);
		expect(result.code).toBe(2);
		expect(result.stderr).toStartWith(
			'thinkrail-extension: "web" (web/index.js) would overwrite --entry (web/index.js)',
		);
		expect(result.stderr).toContain("Usage: thinkrail-extension build");
		expect(readFileSync(join(current.root, "web/index.js"), "utf8")).toContain("toolRenderers");
	});

	it.each([
		[["bundle"], 'unknown command "bundle"'],
		[[], "no command given"],
		[["build", "extra"], 'unexpected argument "extra"'],
		[["build", "--bogus"], "--bogus"],
		[["build", "--prefix"], "--prefix"],
		[["build", "--prefix", "--no-minify"], "--prefix"],
	])("exits 2 with usage for %j", (args, message) => {
		current = fixture(WEB_PACKAGE);
		const result = run(args, current.root);
		expect(result.code).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toStartWith("thinkrail-extension: ");
		expect(result.stderr).toContain(message);
		expect(result.stderr).toContain("Usage: thinkrail-extension build");
		expect(existsSync(join(current.root, "dist/web.js"))).toBe(false);
	});

	it.each([[["--help"]], [["-h"]], [["build", "--help"]]])(
		"prints usage for %j and exits 0",
		(args) => {
			current = fixture(WEB_PACKAGE);
			const result = run(args, current.root);
			expect(result.code).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toContain("--prefix <letters>");
		},
	);
});
