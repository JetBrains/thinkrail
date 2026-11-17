import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { ExtensionBuildError } from "./errors";

const require = createRequire(import.meta.url);

export const PREFIX_PATTERN = /^[a-z]+$/;

export interface StylesOptions {
	root: string;
	sourceDir: string;
	prefix: string;
	css: string | undefined;
	outFile: string;
	minify: boolean;
	assetsDir: URL;
}

function cssString(path: string): string {
	return JSON.stringify(path.replaceAll("\\", "/"));
}

export function stylesheetInput({
	root,
	sourceDir,
	prefix,
	css,
	assetsDir,
}: Omit<StylesOptions, "outFile" | "minify">): string {
	const template = readFileSync(new URL("extension.css", assetsDir), "utf8");
	const source = relative(root, sourceDir) || ".";
	const input = template
		.replace(`"tailwindcss/theme.css"`, cssString(require.resolve("tailwindcss/theme.css")))
		.replace(
			`"@thinkrail/extension-sdk/theme.css"`,
			cssString(fileURLToPath(new URL("thinkrail-theme.css", assetsDir))),
		)
		.replace(`"tailwindcss/utilities.css"`, cssString(require.resolve("tailwindcss/utilities.css")))
		.replace("prefix(extprefix)", `prefix(${prefix})`)
		.replace(`@source "./web";`, `@source ${cssString(`./${source}`)};`);
	return css ? `${input}@import ${cssString(css)};\n` : input;
}

export async function buildStylesheet(options: StylesOptions) {
	let compiled: Awaited<ReturnType<typeof compile>>;
	try {
		compiled = await compile(stylesheetInput(options), {
			base: options.root,
			onDependency() {},
		});
	} catch (error) {
		throw new ExtensionBuildError(
			`building the stylesheet failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const scanner = new Scanner({ sources: compiled.sources });
	const built = compiled.build(scanner.scan());
	const { code } = optimize(built, { minify: options.minify });
	await mkdir(dirname(options.outFile), { recursive: true });
	await writeFile(options.outFile, code);
}
