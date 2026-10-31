import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FixtureExtension {
	file: string;
	tool: string;
	command?: string;
}

export interface FixturePackageOptions {
	name?: string;
	version?: string;
	description?: string;
	extensions?: readonly FixtureExtension[];
	skills?: readonly { name: string; description: string }[];
	prompts?: readonly string[];
}

/** A pi extension module registering one tool (and optionally one command) under the given names. */
export function fixtureExtensionSource(tool: string, command?: string): string {
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

/** Writes a pi package folder with a `pi` manifest for the resources given; returns its path. */
export function writeFixturePiPackage(dir: string, options: FixturePackageOptions = {}): string {
	const extensions = options.extensions ?? [
		{ file: "hello.ts", tool: "fixture_hello", command: "hello" },
		{ file: "legacy.ts", tool: "fixture_legacy" },
	];
	const skills = options.skills ?? [{ name: "triage", description: "Triage fixture." }];
	const prompts = options.prompts ?? ["standup"];
	mkdirSync(join(dir, "extensions"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: options.name ?? "@fixture/pi-tools",
			version: options.version ?? "0.1.0",
			...(options.description === undefined ? {} : { description: options.description }),
			pi: {
				extensions: ["./extensions/*.ts"],
				...(skills.length > 0 ? { skills: ["./skills"] } : {}),
				...(prompts.length > 0 ? { prompts: ["./prompts/*.md"] } : {}),
			},
		}),
	);
	for (const extension of extensions) {
		writeFileSync(
			join(dir, "extensions", extension.file),
			fixtureExtensionSource(extension.tool, extension.command),
		);
	}
	for (const skill of skills) {
		mkdirSync(join(dir, "skills", skill.name), { recursive: true });
		writeFileSync(
			join(dir, "skills", skill.name, "SKILL.md"),
			`---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n`,
		);
	}
	if (prompts.length > 0) mkdirSync(join(dir, "prompts"), { recursive: true });
	for (const prompt of prompts) {
		writeFileSync(
			join(dir, "prompts", `${prompt}.md`),
			`---\ndescription: ${prompt}\n---\n${prompt}\n`,
		);
	}
	return dir;
}
