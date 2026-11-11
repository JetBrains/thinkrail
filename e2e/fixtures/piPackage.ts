import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A pi extension module registering one tool (and optionally one command). */
export function piExtensionSource(tool: string, command?: string): string {
	return [
		"export default function (pi) {",
		"  pi.registerTool({",
		`    name: ${JSON.stringify(tool)}, label: ${JSON.stringify(tool)}, description: "fixture",`,
		'    parameters: { type: "object", properties: {} },',
		'    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),',
		"  });",
		command
			? `  pi.registerCommand(${JSON.stringify(command)}, { description: "fixture", handler: async () => {} });`
			: "",
		"}",
		"",
	].join("\n");
}

/** Writes a local pi package the lane can install by path. */
export function writePiPackageFixture(
	dir: string,
	options: {
		name: string;
		description?: string;
		extension: { file: string; tool: string; command?: string; source?: string };
		skill?: { name: string; description: string };
	},
): string {
	mkdirSync(join(dir, "extensions"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: options.name,
			version: "0.1.0",
			...(options.description ? { description: options.description } : {}),
			pi: {
				extensions: ["./extensions/*.ts"],
				...(options.skill ? { skills: ["./skills"] } : {}),
			},
		}),
	);
	writeFileSync(
		join(dir, "extensions", options.extension.file),
		options.extension.source ??
			piExtensionSource(options.extension.tool, options.extension.command),
	);
	if (options.skill) {
		mkdirSync(join(dir, "skills", options.skill.name), { recursive: true });
		writeFileSync(
			join(dir, "skills", options.skill.name, "SKILL.md"),
			`---\nname: ${options.skill.name}\ndescription: ${options.skill.description}\n---\n\n# ${options.skill.name}\n`,
		);
	}
	return dir;
}
