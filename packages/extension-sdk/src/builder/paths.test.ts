import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExtension, ExtensionUsageError } from ".";
import { ASSETS, type Fixture, fixture, WEB_PACKAGE } from "./testing";

const ENTRY = 'export default { name: "x", toolRenderers: {} };\n';
const SERVER = "export default {};\n";

let current: Fixture | undefined;
const outside: string[] = [];
afterEach(() => {
	current?.dispose();
	current = undefined;
	for (const dir of outside.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(thinkrail: Record<string, unknown>, files: Record<string, string>) {
	current = fixture({ ...WEB_PACKAGE, thinkrail: { api: "1.0", ...thinkrail } }, files);
	return current;
}

async function refused(
	root: string,
	options: { entry?: string; css?: string; prefix?: string } = {},
): Promise<string> {
	try {
		await buildExtension({ root, prefix: "fx", ...options, assetsDir: ASSETS });
	} catch (error) {
		expect(error).toBeInstanceOf(ExtensionUsageError);
		return (error as Error).message;
	}
	throw new Error("the build succeeded");
}

function read(root: string, path: string): string {
	return readFileSync(join(root, path), "utf8");
}

describe("the build never writes over its own inputs", () => {
	it("refuses a web output that is the --entry", async () => {
		const { root } = setup({ web: "./web/index.js" }, { "web/index.js": ENTRY });
		expect(await refused(root, { entry: "web/index.js" })).toBe(
			'"web" (web/index.js) would overwrite --entry (web/index.js): the build\'s outputs must be files of their own, such as ./dist/web.js and ./dist/web.css.',
		);
		expect(read(root, "web/index.js")).toBe(ENTRY);
	});

	it("refuses a web output that is a module the entry imports, after building it aside", async () => {
		const app = 'export const app = "mine";\n';
		const { root } = setup(
			{ web: "./web/app.js" },
			{ "web/index.js": 'export { app as default } from "./app.js";\n', "web/app.js": app },
		);
		expect(await refused(root, { entry: "web/index.js" })).toContain(
			'"web" (web/app.js) would overwrite a module the web entry imports (web/app.js)',
		);
		expect(read(root, "web/app.js")).toBe(app);
		expect(readdirSync(join(root, "web")).sort()).toEqual(["app.js", "index.js"]);
	});

	it("refuses a web output that is a module the bundle tree-shakes away", async () => {
		const app = 'export const unused = "mine";\n';
		const { root } = setup(
			{ web: "./web/app.js" },
			{
				"web/index.js": 'import { unused } from "./app.js";\nvoid unused;\nexport default {};\n',
				"web/app.js": app,
			},
		);
		expect(await refused(root, { entry: "web/index.js" })).toContain(
			'"web" (web/app.js) would overwrite a module the web entry imports (web/app.js)',
		);
		expect(read(root, "web/app.js")).toBe(app);
	});

	it("refuses a styles output that is a stylesheet --css imports", async () => {
		const shared = ".a { color: red; }\n";
		const { root } = setup(
			{ web: "./dist/web.js", styles: "./styles/shared.css" },
			{
				"web/index.tsx": ENTRY,
				"styles/own.css": '@import "./shared.css";\n',
				"styles/shared.css": shared,
			},
		);
		expect(await refused(root, { css: "styles/own.css" })).toContain(
			'"styles" (styles/shared.css) would overwrite a stylesheet the build reads',
		);
		expect(read(root, "styles/shared.css")).toBe(shared);
		expect(existsSync(join(root, "dist/web.js"))).toBe(false);
	});

	it("refuses a web output linked to the default entry", async () => {
		const { root } = setup({ web: "./dist/web.js" }, { "web/index.tsx": ENTRY });
		mkdirSync(join(root, "dist"));
		symlinkSync(join(root, "web/index.tsx"), join(root, "dist/web.js"));
		expect(await refused(root)).toContain(
			'"web" (dist/web.js) would overwrite the web entry (web/index.tsx)',
		);
		expect(read(root, "web/index.tsx")).toBe(ENTRY);
	});

	it("refuses a web output that is the --css file", async () => {
		const { root } = setup(
			{ web: "./dist/web.js", styles: "./dist/web.css" },
			{ "web/index.tsx": ENTRY, "dist/web.js": "/* mine */\n" },
		);
		expect(await refused(root, { css: "dist/web.js" })).toContain(
			'"web" (dist/web.js) would overwrite --css (dist/web.js)',
		);
		expect(read(root, "dist/web.js")).toBe("/* mine */\n");
	});

	it("refuses a styles output that is the --css file", async () => {
		const { root } = setup(
			{ web: "./dist/web.js", styles: "./styles/own.css" },
			{ "web/index.tsx": ENTRY, "styles/own.css": ".a{}\n" },
		);
		expect(await refused(root, { css: "./styles/own.css" })).toContain(
			'"styles" (styles/own.css) would overwrite --css (styles/own.css)',
		);
		expect(read(root, "styles/own.css")).toBe(".a{}\n");
	});

	it("refuses a web output that is the server file", async () => {
		const { root } = setup(
			{ server: "./dist/web.js", web: "./dist/web.js" },
			{ "web/index.tsx": ENTRY, "dist/web.js": SERVER },
		);
		expect(await refused(root)).toContain(
			'"web" (dist/web.js) would overwrite the "server" file (dist/web.js)',
		);
		expect(read(root, "dist/web.js")).toBe(SERVER);
	});

	it("refuses an output linked to package.json", async () => {
		const { root } = setup({ web: "./dist/web.js" }, { "web/index.tsx": ENTRY });
		mkdirSync(join(root, "dist"));
		symlinkSync(join(root, "package.json"), join(root, "dist/web.js"));
		expect(await refused(root)).toContain('"web" (dist/web.js) would overwrite package.json');
		expect(JSON.parse(read(root, "package.json")).name).toBe(WEB_PACKAGE.name);
	});

	it("refuses two outputs that are one file", async () => {
		const { root } = setup(
			{ web: "./dist/web.js", styles: "./dist/web.css" },
			{ "web/index.tsx": ENTRY, "dist/web.js": "/* previous */\n" },
		);
		symlinkSync(join(root, "dist/web.js"), join(root, "dist/web.css"));
		expect(await refused(root)).toContain(
			'"web" (dist/web.js) would overwrite "styles" (dist/web.css)',
		);
		expect(read(root, "dist/web.js")).toBe("/* previous */\n");
	});

	it("refuses an output nested in an input", async () => {
		const { root } = setup({ web: "./web/index.tsx/web.js" }, { "web/index.tsx": ENTRY });
		expect(await refused(root)).toContain(
			'"web" (web/index.tsx/web.js) and the web entry (web/index.tsx) overlap, one inside the other',
		);
	});

	it("refuses an output that is a directory", async () => {
		const folder = setup({ web: "./dist/web.js" }, { "web/index.tsx": ENTRY, "dist/web.js/a": "" });
		expect(await refused(folder.root)).toBe(
			'"web" (dist/web.js) is a directory: point it at a file the build owns.',
		);
		expect(existsSync(join(folder.root, "dist/web.js/a"))).toBe(true);
	});

	it("refuses an output that resolves outside the package", async () => {
		const elsewhere = mkdtempSync(join(tmpdir(), "thinkrail-extension-sdk-outside-"));
		outside.push(elsewhere);
		const { root } = setup({ web: "./dist/web.js" }, { "web/index.tsx": ENTRY });
		symlinkSync(elsewhere, join(root, "dist"));
		expect(await refused(root)).toContain("outside the package");
		expect(readdirSync(elsewhere)).toEqual([]);
	});

	it("compares paths the way the file system does", async () => {
		const { root } = setup({ web: "./WEB/Index.js" }, { "web/index.js": ENTRY });
		const insensitive = existsSync(join(root, "PACKAGE.JSON"));
		if (insensitive) {
			expect(await refused(root, { entry: "web/index.js" })).toContain(
				'"web" (WEB/Index.js) would overwrite --entry (web/index.js)',
			);
		} else {
			await buildExtension({ root, entry: "web/index.js", assetsDir: ASSETS });
		}
		expect(read(root, "web/index.js")).toBe(ENTRY);
	});
});

describe("a failed build keeps the previous output", () => {
	const previous = { "dist/web.js": "/* previous bundle */\n", "dist/web.css": "/* previous */\n" };

	function untouched(root: string) {
		expect(read(root, "dist/web.js")).toBe(previous["dist/web.js"]);
		expect(read(root, "dist/web.css")).toBe(previous["dist/web.css"]);
		expect(readdirSync(join(root, "dist")).sort()).toEqual(["web.css", "web.js"]);
	}

	it("when bundling fails", async () => {
		const { root } = setup(
			{ web: "./dist/web.js", styles: "./dist/web.css" },
			{ "web/index.tsx": 'import "not-installed";\n', ...previous },
		);
		await expect(buildExtension({ root, prefix: "fx", assetsDir: ASSETS })).rejects.toThrow(
			"cannot be resolved",
		);
		untouched(root);
	});

	it("when the stylesheet fails after the bundle was built", async () => {
		const { root } = setup(
			{ web: "./dist/web.js", styles: "./dist/web.css" },
			{ "web/index.tsx": ENTRY, "web/own.css": ".a { @apply fx:no-such-utility; }\n", ...previous },
		);
		await expect(
			buildExtension({ root, prefix: "fx", css: "web/own.css", assetsDir: ASSETS }),
		).rejects.toThrow("building the stylesheet failed");
		untouched(root);
	});

	it("replaces both files once both are built", async () => {
		const { root } = setup(
			{ web: "./dist/web.js", styles: "./dist/web.css" },
			{ "web/index.tsx": ENTRY, ...previous },
		);
		await buildExtension({ root, prefix: "fx", assetsDir: ASSETS });
		expect(read(root, "dist/web.js")).not.toBe(previous["dist/web.js"]);
		expect(read(root, "dist/web.css")).not.toBe(previous["dist/web.css"]);
		expect(readdirSync(join(root, "dist")).sort()).toEqual(["web.css", "web.js"]);
	});
});
