import { afterEach, describe, expect, it } from "bun:test";
import { ExtensionBuildError } from "./errors";
import { readExtensionPackage } from "./manifest";
import { type Fixture, fixture } from "./testing";

let current: Fixture | undefined;
afterEach(() => {
	current?.dispose();
	current = undefined;
});

const SERVER = { "server/index.ts": "export default {};\n" };

function read(packageJson: Record<string, unknown>, files: Record<string, string> = SERVER) {
	current = fixture(packageJson, files);
	return readExtensionPackage(current.root);
}

function problems(thinkrail: unknown, extra: Record<string, unknown> = {}): string {
	try {
		read({ name: "thinkrail-ext-x", thinkrail, ...extra });
	} catch (error) {
		expect(error).toBeInstanceOf(ExtensionBuildError);
		return (error as Error).message;
	}
	throw new Error("the manifest was accepted");
}

describe("the thinkrail manifest", () => {
	it("accepts the documented shape", () => {
		const pkg = read({
			name: "thinkrail-ext-weather",
			keywords: ["thinkrail-extension"],
			dependencies: { "@thinkrail/extension-sdk": "1.0.0" },
			peerDependencies: { typebox: "*" },
			thinkrail: {
				api: "1.0",
				server: "./server/index.ts",
				web: "./dist/web.js",
				styles: "./dist/web.css",
				title: "Weather",
				image: "https://example.com/preview.png",
			},
		});
		expect(pkg.name).toBe("thinkrail-ext-weather");
		expect(pkg.manifest.title).toBe("Weather");
		expect(pkg.warnings).toEqual([]);
	});

	it("requires a package name and a manifest", () => {
		current = fixture({ thinkrail: { api: "1.0", web: "./dist/web.js" } });
		expect(() => readExtensionPackage(current?.root ?? "")).toThrow('needs a "name"');
		expect(() => read({ name: "x" })).toThrow('no "thinkrail" manifest');
	});

	it.each([
		[{ web: "./dist/web.js" }, '"api" is required'],
		[{ api: "1", web: "./dist/web.js" }, '"major.minor"'],
		[{ api: "2.0", web: "./dist/web.js" }, 'set "api" to "1.0"'],
		[{ api: "1.1", web: "./dist/web.js" }, "builds extension API 1.0"],
		[{ api: "1.0" }, 'at least one of "server" and "web"'],
		[{ api: "1.0", server: "./server/index.ts", styles: "./a.css" }, '"styles" is only allowed'],
		[{ api: "1.0", web: "../outside.js" }, "inside the package"],
		[{ api: "1.0", web: "/abs/web.js" }, "inside the package"],
		[{ api: "1.0", web: "./dist/web.ts" }, "must end in .js"],
		[{ api: "1.0", web: "./dist/web.js", styles: "./dist/web.scss" }, "must end in .css"],
		[{ api: "1.0", server: "./server/missing.ts" }, "does not exist"],
		[{ api: "1.0", web: "./dist/web.js", image: "http://x/y.png" }, "https:// URL"],
		[{ api: 1, web: "./dist/web.js" }, '"api" must be a string'],
	])("rejects %j", (thinkrail, message) => {
		expect(problems(thinkrail)).toContain(message);
	});

	it("keeps pi and typebox out of the extension's dependencies", () => {
		const message = problems(
			{ api: "1.0", server: "./server/index.ts" },
			{ dependencies: { typebox: "1.3.27", "@earendil-works/pi-coding-agent": "1.5.0" } },
		);
		expect(message).toContain("@earendil-works/pi-coding-agent, typebox must be peerDependencies");
	});

	it("warns about a missing keyword, a missing SDK dependency and unknown fields", () => {
		const pkg = read({
			name: "thinkrail-ext-x",
			thinkrail: { api: "1.0", server: "./server/index.ts", tools: ["x"] },
		});
		expect(pkg.warnings).toHaveLength(3);
		expect(pkg.warnings.join("\n")).toContain('"thinkrail.tools" is not a manifest field');
		expect(pkg.warnings.join("\n")).toContain('list @thinkrail/extension-sdk under "dependencies"');
		expect(pkg.warnings.join("\n")).toContain('add "thinkrail-extension" to "keywords"');
	});
});
