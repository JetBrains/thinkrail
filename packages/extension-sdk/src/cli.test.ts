import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
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

	it("prints usage for an unknown command or option", () => {
		current = fixture(WEB_PACKAGE);
		expect(run(["bundle"], current.root).code).toBe(2);
		const unknown = run(["build", "--bogus"], current.root);
		expect(unknown.code).toBe(1);
		expect(unknown.stderr).toContain("Usage: thinkrail-extension build");
		expect(run(["--help"], current.root).stdout).toContain("--prefix <letters>");
	});
});
