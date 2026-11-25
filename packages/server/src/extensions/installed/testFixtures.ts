import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionInstaller } from "./installer";

let counter = 0;

export function tempDir(prefix = "thinkrail-ext-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export interface FixtureOptions {
	name?: string;
	api?: string;
	server?: string | false;
	web?: string | false;
	styles?: string | false;
	files?: Record<string, string>;
	manifest?: Record<string, unknown>;
	version?: string;
	extra?: Record<string, unknown>;
}

/** A tool-registering descriptor; each call gets a unique tool name so Bun never serves a cached body. */
export function toolDescriptor(name: string, tool = `tool_${++counter}`): string {
	return `import { Type } from "typebox";
import { defineServerExtension } from "./sdk.ts";
export default defineServerExtension({
	name: ${JSON.stringify(name)},
	title: "Fixture",
	extensions: [
		(pi) => {
			pi.registerTool({
				name: ${JSON.stringify(tool)},
				label: "Fixture tool",
				description: "A fixture tool",
				parameters: Type.Object({}),
				async execute() {
					return { content: [{ type: "text", text: "ok" }], details: {} };
				},
			});
		},
	],
	settings: { verbose: { type: "boolean", default: false, title: "Verbose", description: "Say more" } },
});
`;
}

export function writeExtension(root: string, options: FixtureOptions = {}): string {
	const name = options.name ?? `fixture-ext-${++counter}`;
	const server = options.server === false ? undefined : (options.server ?? "server/index.ts");
	const web = options.web === false ? undefined : options.web;
	const styles = options.styles === false ? undefined : options.styles;
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			name,
			version: options.version ?? "1.0.0",
			description: "A fixture extension",
			type: "module",
			...options.extra,
			thinkrail: {
				api: options.api ?? "1.0",
				...(server ? { server } : {}),
				...(web ? { web } : {}),
				...(styles ? { styles } : {}),
				...options.manifest,
			},
		}),
	);
	const files: Record<string, string> = {
		...(server ? { [server]: toolDescriptor(name), "server/sdk.ts": SDK } : {}),
		...(web ? { [web]: "export default { name: 'x', toolRenderers: {} };\n" } : {}),
		...(styles ? { [styles]: ".x-a { color: red; }\n" } : {}),
		...options.files,
	};
	for (const [file, body] of Object.entries(files)) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), body);
	}
	return root;
}

const SDK = "export const defineServerExtension = (descriptor) => descriptor;\n";

/** Installs an npm/git source by copying `templates[source]` where pi would put it; never touches the network. */
export function stubInstaller(
	templates: Record<string, string>,
	updates: ReadonlySet<string> = new Set(),
): ExtensionInstaller & { installs: string[] } {
	const installs: string[] = [];
	return {
		installs,
		async install(source, installDir) {
			installs.push(source);
			const template = templates[source];
			if (!template) throw new Error(`404 Not Found - ${source}`);
			const path = join("npm", "node_modules", source.replace(/^npm:/, "").replace(/@[^/]*$/, ""));
			cpSync(template, join(installDir, path), { recursive: true });
			return path;
		},
		async hasUpdate(source) {
			return updates.has(source);
		},
	};
}
