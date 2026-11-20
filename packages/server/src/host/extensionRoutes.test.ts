import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstalledExtensions, listExtensionCatalog } from "../extensions";
import { serveExtensionAsset } from "./extensionRoutes";

let root: string;
let runtime: InstalledExtensions;

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "host-extension-routes-"));
	const folder = join(root, "ext");
	mkdirSync(join(folder, "dist"), { recursive: true });
	writeFileSync(
		join(folder, "package.json"),
		JSON.stringify({
			name: "@jane/cards",
			version: "1.0.0",
			thinkrail: { api: "1.0", web: "dist/web.js", styles: "dist/web.css" },
		}),
	);
	writeFileSync(join(folder, "dist", "web.js"), "export default {};\n");
	writeFileSync(join(folder, "dist", "web.css"), ".cards-a{}\n");
	writeFileSync(join(folder, "secret.txt"), "secret");
	mkdirSync(join(root, "data"));
	writeFileSync(join(root, "data", "extensions.json"), JSON.stringify({ extensions: [folder] }));
	runtime = new InstalledExtensions({
		dataDir: join(root, "data"),
		reservedNames: () => [],
		skillRoots: () => [],
	});
	await runtime.reconcile();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const get = (path: string, method = "GET") =>
	serveExtensionAsset(new Request(`http://host${path}`, { method }), path, runtime.records());

async function urls(): Promise<{ url: string; styles: string }> {
	const [entry] = await listExtensionCatalog(new Set(), [], runtime.records());
	if (!entry?.web?.styles) throw new Error("fixture has no web half");
	return { url: entry.web.url, styles: entry.web.styles };
}

describe("GET /extensions/<name>/<token>/<file>", () => {
	it("serves the web half and its stylesheet as immutable JavaScript and CSS", async () => {
		const { url, styles } = await urls();
		const js = get(url);
		expect(js.status).toBe(200);
		expect(js.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
		expect(js.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(js.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
		expect(await js.text()).toBe("export default {};\n");
		const css = get(styles);
		expect(css.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
		expect(get(url, "HEAD").status).toBe(200);
	});

	it("answers 404 for anything else and 405 for a write", async () => {
		const { url } = await urls();
		const base = url.replace(/dist\/web\.js$/, "");
		for (const path of [
			`${base}secret.txt`,
			`${base}package.json`,
			`${base}dist/../secret.txt`,
			`${base}%2E%2E/secret.txt`,
			url.replace("%40jane%2Fcards", "%40jane%2Fother"),
			url.replace(/-[0-9a-f]{12}\//, "-ffffffffffff/"),
			"/extensions/",
		]) {
			expect(get(path).status).toBe(404);
		}
		expect(get(url, "POST").status).toBe(405);
		expect(get(url, "POST").headers.get("Allow")).toBe("GET, HEAD");
	});
});
