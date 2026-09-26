import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ExtensionSurface } from "@thinkrail/contracts";
import type { BunPlugin } from "bun";
import { compileExtensionCss } from "./css";
import { runtimeGlobalPlugin } from "./runtimeShims";
import { ownSourcesMap } from "./sourceMap";
import { errorMessage } from "./util";

interface ExtAsset {
	body: string;
	contentType: string;
}

export interface ExtAssets {
	build: string;
	files: ReadonlyMap<string, ExtAsset>;
}

const JS_TYPE = "text/javascript; charset=utf-8";
const CSS_TYPE = "text/css; charset=utf-8";
const BUILD_ID_LENGTH = 16;

const INLINE_ASSET = /\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/;

const dataUrl = async (path: string) => {
	const file = Bun.file(path);
	const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
	return `data:${file.type};base64,${base64}`;
};

const inlineAssetPlugin: BunPlugin = {
	name: "thinkrail-inline-assets",
	setup(build) {
		build.onResolve({ filter: INLINE_ASSET }, async (args) =>
			args.importer.endsWith(".css")
				? { path: await dataUrl(resolve(dirname(args.importer), args.path)), external: true }
				: undefined,
		);
		build.onLoad({ filter: INLINE_ASSET }, async (args) => ({
			loader: "js",
			contents: `export default ${JSON.stringify(await dataUrl(args.path))};`,
		}));
	},
};

interface BuildLog {
	message: string;
	position?: { file: string; line: number; column: number } | null;
}

const isBuildLog = (value: unknown): value is BuildLog =>
	typeof value === "object" && value !== null && "message" in value;

const formatLog = (dir: string, log: BuildLog) => {
	const at = log.position;
	return at?.file
		? `${relative(dir, at.file)}:${at.line}:${at.column}: ${log.message}`
		: log.message;
};

const isOwnSource = (source: string) => !source.includes("node_modules/") && !source.includes(":");

const inlineMap = (json: string) =>
	`\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(
		ownSourcesMap(json, isOwnSource),
	).toString("base64")}\n`;

const buildErrors = (dir: string, error: unknown) => {
	const logs = error instanceof AggregateError ? error.errors : [error];
	return logs.map((log) => (isBuildLog(log) ? formatLog(dir, log) : errorMessage(log)));
};

export const buildSurface = async ({
	dir: rawDir,
	surfaceId,
}: {
	dir: string;
	surfaceId: string;
}) => {
	const dir = await realpath(rawDir);
	let result: Bun.BuildOutput;
	try {
		result = await Bun.build({
			entrypoints: [join(dir, `${surfaceId}.tsx`)],
			target: "browser",
			format: "esm",
			splitting: false,
			sourcemap: "external",
			minify: { whitespace: true, syntax: true },
			jsx: { runtime: "automatic", development: false },
			define: { "process.env.NODE_ENV": JSON.stringify("production") },
			plugins: [runtimeGlobalPlugin, inlineAssetPlugin],
		});
	} catch (error) {
		throw new Error(buildErrors(dir, error).join("\n"));
	}
	if (!result.success)
		throw new Error(
			result.logs
				.filter((log) => log.level === "error")
				.map((log) => formatLog(dir, log))
				.join("\n"),
		);
	const entry = result.outputs.find((output) => output.kind === "entry-point");
	if (!entry) throw new Error(`${surfaceId}.tsx: build produced no entry point`);
	const code = await entry.text();
	const map = result.outputs.find((output) => output.kind === "sourcemap");
	const js = map ? `${code}${inlineMap(await map.text())}` : code;
	const importedCss = await Promise.all(
		result.outputs.filter((output) => output.path.endsWith(".css")).map((output) => output.text()),
	);
	const css = [
		await compileExtensionCss(code),
		...importedCss.map((text) => `@layer components {\n${text}\n}`),
	].join("\n");
	return { js, css };
};

const readThemeCss = async (dir: string, themes: readonly ThemeCss[]) =>
	Promise.all(
		themes.flatMap(({ id, cssFile }) =>
			cssFile === undefined
				? []
				: [
						Bun.file(join(dir, cssFile))
							.text()
							.then((css) => ({ id, css })),
					],
		),
	);

interface ThemeCss {
	id: string;
	cssFile?: string;
}

export const buildAssets = async ({
	dir,
	surfaces,
	themes = [],
}: {
	dir: string;
	surfaces: readonly ExtensionSurface[];
	themes?: readonly ThemeCss[];
}): Promise<ExtAssets> => {
	const results = await Promise.allSettled(
		surfaces.map((surface) => buildSurface({ dir, surfaceId: surface.id })),
	);
	const failures = results.flatMap((result) =>
		result.status === "rejected" ? [errorMessage(result.reason)] : [],
	);
	if (failures.length > 0) throw new Error(`view build failed:\n${failures.join("\n")}`);
	const themeCss = await readThemeCss(dir, themes).catch((error: unknown) => {
		throw new Error(`theme css: ${errorMessage(error)}`);
	});
	const hash = createHash("sha256");
	const files = new Map<string, ExtAsset>();
	for (const { id, css } of themeCss) {
		hash.update(`theme:${id}\0${css}\0`);
		files.set(`${id}.theme.css`, { body: css, contentType: CSS_TYPE });
	}
	results.forEach((result, index) => {
		const surface = surfaces[index];
		if (result.status !== "fulfilled" || !surface) return;
		hash.update(`${surface.id}\0${result.value.js}\0${result.value.css}\0`);
		files.set(`${surface.id}.js`, { body: result.value.js, contentType: JS_TYPE });
		files.set(`${surface.id}.css`, { body: result.value.css, contentType: CSS_TYPE });
	});
	return { build: hash.digest("hex").slice(0, BUILD_ID_LENGTH), files };
};
