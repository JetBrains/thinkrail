import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHARED_MODULE_EXPORTS } from "@thinkrail/extension-api/installed";
import {
	EXTENSION_API_VERSION,
	SHARED_SPECIFIERS,
	type SharedModulesManifest,
} from "../src/shared";
import { SHARED_SOURCES, WHOLE_PUBLIC_API_EXCEPT } from "./sources";

const ASSETS = new URL("../assets/", import.meta.url);
const APP_SRC = new URL("../../../apps/web/src/", import.meta.url);

export const MANIFEST_FILE = new URL("shared-modules.json", ASSETS);
export const THEME_FILE = new URL("thinkrail-theme.css", ASSETS);

const NOT_PUBLIC = /^(?:default$|__|unstable_|experimental_)/;

export function unlistedPublicNames(
	namespace: Record<string, unknown>,
	listed: readonly string[],
	leftOut: readonly string[],
): string[] {
	return Object.keys(namespace)
		.filter((name) => !NOT_PUBLIC.test(name) && !listed.includes(name) && !leftOut.includes(name))
		.sort();
}

export async function sharedModulesManifest(): Promise<SharedModulesManifest> {
	if (process.env.NODE_ENV !== "production") {
		throw new Error("the export manifest is read from production modules: set NODE_ENV=production");
	}
	const modules = {} as SharedModulesManifest["modules"];
	for (const specifier of SHARED_SPECIFIERS) {
		const source = SHARED_SOURCES[specifier];
		const namespace = (await import(source)) as Record<string, unknown>;
		const names: readonly string[] = SHARED_MODULE_EXPORTS[specifier];
		const missing = names.filter((name) => namespace[name] === undefined);
		if (missing.length > 0) {
			throw new Error(
				`${source} no longer exports ${missing.join(", ")}, which extension API ${EXTENSION_API_VERSION} promises as ${specifier}`,
			);
		}
		const leftOut = WHOLE_PUBLIC_API_EXCEPT[specifier];
		const unlisted = leftOut ? unlistedPublicNames(namespace, names, leftOut) : [];
		if (unlisted.length > 0) {
			throw new Error(
				`${source} now exports ${unlisted.join(", ")}, which extension API ${EXTENSION_API_VERSION} does not list as ${specifier}: allow-list it in SHARED_MODULE_EXPORTS (an API minor, with a new snapshot) or leave it out in WHOLE_PUBLIC_API_EXCEPT (packages/extension-sdk/tools/sources.ts)`,
			);
		}
		modules[specifier] = [...names];
	}
	return { api: EXTENSION_API_VERSION, modules };
}

function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function blocks(css: string, opener: RegExp): string[] {
	const found: string[] = [];
	for (const match of css.matchAll(opener)) {
		let depth = 0;
		for (let index = match.index; index < css.length; index++) {
			if (css[index] === "{") depth++;
			else if (css[index] === "}" && --depth === 0) {
				found.push(css.slice(match.index, index + 1));
				break;
			}
		}
	}
	return found;
}

function appCss(path: string): string {
	return stripComments(readFileSync(new URL(path, APP_SRC), "utf8"));
}

export function themeCss(): string {
	const index = appCss("index.css");
	const parts = [
		"/* Generated from apps/web/src by @thinkrail/extension-sdk — do not edit. Reference-only: import it with theme(reference). */",
		...blocks(appCss("styles/generated/colors.css"), /@theme inline \{/g),
		...blocks(appCss("styles/generated/spacing.css"), /@theme inline \{/g),
		...blocks(appCss("styles/tokens.css"), /@theme static \{/g).map((block) =>
			block.replace("@theme static", "@theme inline"),
		),
		...blocks(index, /@theme inline \{/g),
		...[...index.matchAll(/@custom-variant [^;]+;/g)].map((match) => match[0]),
	];
	return `${parts.map((part) => part.replace(/\n\s*\n/g, "\n")).join("\n\n")}\n`;
}

export function manifestJson(manifest: SharedModulesManifest): string {
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

if (import.meta.main) {
	const manifest = await sharedModulesManifest();
	const theme = themeCss();
	if (process.argv.includes("--check")) {
		const stale = [
			JSON.stringify(JSON.parse(readFileSync(MANIFEST_FILE, "utf8"))) !== JSON.stringify(manifest)
				? MANIFEST_FILE
				: undefined,
			readFileSync(THEME_FILE, "utf8") !== theme ? THEME_FILE : undefined,
		].filter((file) => file !== undefined);
		for (const file of stale) {
			console.error(
				`${file.pathname} is stale — run \`bun run generate\` in packages/extension-sdk`,
			);
		}
		if (stale.length > 0) process.exit(1);
	} else {
		writeFileSync(MANIFEST_FILE, manifestJson(manifest));
		writeFileSync(THEME_FILE, theme);
		const repo = fileURLToPath(new URL("../../../", import.meta.url));
		const biome = Bun.spawnSync(
			[`${repo}node_modules/.bin/biome`, "format", "--write", fileURLToPath(MANIFEST_FILE)],
			{
				cwd: repo,
				stdout: "ignore",
				stderr: "inherit",
			},
		);
		if (biome.exitCode !== 0) process.exit(biome.exitCode);
	}
}
