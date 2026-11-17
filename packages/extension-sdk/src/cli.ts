import { parseArgs } from "node:util";
import { buildExtension, DEFAULT_ENTRIES, ExtensionBuildError } from "./builder";
import { EXTENSION_API_VERSION } from "./shared";

const USAGE = `Usage: thinkrail-extension build [options]

Builds the web half of the ThinkRail extension in the current folder, reading
the "thinkrail" manifest in its package.json: the bundle goes to "web", the
stylesheet to "styles". Extension API ${EXTENSION_API_VERSION}.

Options:
  --prefix <letters>  Tailwind prefix for the extension's utilities (a–z only).
                      Required when the manifest declares "styles"; write
                      classes as <prefix>:p-8.
  --entry <file>      Web entry (default: ${DEFAULT_ENTRIES.join(" or ")}).
  --css <file>        Extra stylesheet appended to the generated one.
  --cwd <dir>         Extension folder (default: the current folder).
  --no-minify         Keep the bundle and stylesheet readable.
  -h, --help          Show this help.`;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		allowNegative: true,
		options: {
			prefix: { type: "string" },
			entry: { type: "string" },
			css: { type: "string" },
			cwd: { type: "string" },
			minify: { type: "boolean", default: true },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		console.log(USAGE);
		return 0;
	}
	const [command, ...rest] = positionals;
	if (command !== "build" || rest.length > 0) {
		console.error(USAGE);
		return 2;
	}
	const result = await buildExtension({
		root: values.cwd ?? process.cwd(),
		prefix: values.prefix,
		entry: values.entry,
		css: values.css,
		minify: values.minify,
		assetsDir: new URL("../assets/", import.meta.url),
	});
	for (const warning of result.warnings) console.warn(`warning: ${warning}`);
	if (result.files.length === 0) {
		console.log(`${result.name}: nothing to build (no "web" in the manifest).`);
	}
	for (const file of result.files) console.log(`${result.name}: ${file.path} ${file.bytes} B`);
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		if (error instanceof ExtensionBuildError)
			console.error(`thinkrail-extension: ${error.message}`);
		else if (error instanceof Error && error.name === "TypeError" && "code" in error) {
			console.error(`thinkrail-extension: ${error.message}\n\n${USAGE}`);
		} else console.error(error);
		process.exitCode = 1;
	},
);
