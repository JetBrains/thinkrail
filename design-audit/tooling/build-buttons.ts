// Builds the button-system catalog from isolated fixture sources.
//   bun design-audit/tooling/build-buttons.ts          → design-audit/buttons.html (self-contained)
//   bun design-audit/tooling/build-buttons.ts --serve  → live preview at http://localhost:24390/
// Specimens are styled ONLY by the production stylesheet from apps/web/dist (run `bun run build:web` first).
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dir, "../..");
const WEB = join(ROOT, "apps/web");
const CATALOG = join(ROOT, "design-audit/buttons");
const TARGET = join(ROOT, "design-audit/buttons.html");
const FIXTURES = join(ROOT, "design-audit");
const OUT_DIR = join(ROOT, "design-audit/.build");
const DIST_ASSETS = join(WEB, "dist/assets");

if (!existsSync(DIST_ASSETS))
	throw new Error("apps/web/dist is missing — run `bun run build:web` first");
const prodCss = readdirSync(DIST_ASSETS).filter((f) => /^index-.*\.css$/.test(f));
if (prodCss.length !== 1)
	throw new Error(`expected exactly one production entry stylesheet, found ${prodCss.join(", ")}`);
const PROD_CSS = prodCss[0];

const fromWeb = (spec: string) => import(pathToFileURL(join(WEB, "node_modules", spec)).href);
const vite = await fromWeb("vite/dist/node/index.js");
const react = (await fromWeb("@vitejs/plugin-react/dist/index.js")).default;

// Bare specifiers imported from the fixture sources resolve exactly as they would from apps/web/src.
const resolveLikeWeb = {
	name: "dsa-resolve-like-web",
	enforce: "pre" as const,
	async resolveId(
		this: { resolve: (s: string, i: string, o: object) => Promise<unknown> },
		source: string,
		importer: string | undefined,
	) {
		if (!importer?.startsWith(FIXTURES) || importer.includes("/tooling/")) return null;
		if (
			source.startsWith(".") ||
			source.startsWith("/") ||
			source.startsWith("@/") ||
			source.startsWith("\0")
		)
			return null;
		return this.resolve(source, join(WEB, "src/main.tsx"), { skipSelf: true });
	},
};

const serve = process.argv.includes("--serve");
const config = {
	configFile: false,
	root: CATALOG,
	plugins: [resolveLikeWeb, react()],
	resolve: { alias: [{ find: "@", replacement: join(WEB, "src") }] },
	define: { "process.env.NODE_ENV": JSON.stringify(serve ? "development" : "production") },
	logLevel: "warn" as const,
	worker: { format: "es" as const },
	build: {
		outDir: OUT_DIR,
		emptyOutDir: true,
		rolldownOptions: { output: { codeSplitting: false } },
		assetsInlineLimit: 100_000_000,
		cssCodeSplit: false,
		modulePreload: false,
		chunkSizeWarningLimit: 100_000,
	},
	server: { port: 24390, strictPort: true, fs: { allow: [ROOT] } },
};

if (serve) {
	const server = await vite.createServer({
		...config,
		plugins: [
			...config.plugins,
			{
				name: "dsa-prod-css",
				configureServer(s: {
					middlewares: {
						use: (
							p: string,
							h: (
								req: { url: string },
								res: { setHeader: (k: string, v: string) => void; end: (b: Buffer) => void },
								next: () => void,
							) => void,
						) => void;
					};
				}) {
					s.middlewares.use("/assets", (req, res, next) => {
						const file = join(DIST_ASSETS, req.url.split("?")[0]);
						if (!existsSync(file)) return next();
						if (file.endsWith(".css")) res.setHeader("Content-Type", "text/css");
						if (file.endsWith(".woff2")) res.setHeader("Content-Type", "font/woff2");
						res.end(readFileSync(file));
					});
				},
				transformIndexHtml: (html: string) =>
					html.replace(
						"<!--DSA_PRODUCTION_CSS-->",
						`<link rel="stylesheet" data-dsa-production href="/assets/${PROD_CSS}">`,
					),
			},
		],
	});
	await server.listen();
	console.log("catalog preview: http://localhost:24390/");
} else {
	await vite.build(config);
	let html = readFileSync(join(OUT_DIR, "index.html"), "utf8");
	const assets = join(OUT_DIR, "assets");
	const files = readdirSync(assets);
	const scripts = files.filter((f) => f.endsWith(".js"));
	if (scripts.length !== 1)
		throw new Error(`expected a single catalog script chunk, got ${scripts.join(", ")}`);
	const js = readFileSync(join(assets, scripts[0]), "utf8")
		.replace(/<\/script/gi, "<\\/script")
		.replace(/<!--/g, "<\\!--");
	const chromeCss = files
		.filter((f) => f.endsWith(".css"))
		.map((f) => readFileSync(join(assets, f), "utf8"))
		.join("\n");
	let prod = readFileSync(join(DIST_ASSETS, PROD_CSS), "utf8");
	prod = prod.replace(
		/url\(\/assets\/([^)]+\.woff2)\)/g,
		(_m, f: string) =>
			`url(data:font/woff2;base64,${readFileSync(join(DIST_ASSETS, f)).toString("base64")})`,
	);
	prod = prod.replace(
		/url\("?\/custom-icons\/([^)"]+\.svg)"?\)/g,
		(_m, f: string) =>
			`url("data:image/svg+xml;base64,${readFileSync(join(WEB, "public/custom-icons", f)).toString("base64")}")`,
	);
	if (/url\(\/assets\//.test(prod))
		throw new Error("production CSS still references external assets");
	html = html
		.replace(/<script type="module"[^>]*src="[^"]+"><\/script>/, "")
		.replace(/<link rel="stylesheet"[^>]*>/g, "")
		.replace(
			"<!--DSA_PRODUCTION_CSS-->",
			() =>
				`<style data-dsa-production data-source="apps/web/dist/assets/${PROD_CSS}">${prod}</style>\n<style data-dsa-chrome>${chromeCss}</style>`,
		)
		.replace("</body>", () => `<script type="module">${js}</script>\n</body>`);
	const target = TARGET;
	writeFileSync(target, html);
	rmSync(OUT_DIR, { recursive: true, force: true });
	console.log(
		`wrote ${target} (${(html.length / 1024 / 1024).toFixed(2)} MB; production css ${PROD_CSS})`,
	);
}
