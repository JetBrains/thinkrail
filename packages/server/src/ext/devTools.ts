import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionInfo } from "@thinkrail/contracts";
import guide from "@thinkrail/ext/README.md" with { type: "text" };
import { Type } from "typebox";
import { projectExtensionsDir } from "./discovery";
import type { ExtHost, ExtLogEntry, ExtValidation } from "./host";

const PROMPT_SECTION = "thinkrail-extensions";

export const EXT_SDK_GUIDE = guide;

type DevHost = Pick<ExtHost, "validate" | "reload" | "logs" | "get" | "roots">;

const PROJECT_ROOT = projectExtensionsDir("<project>");

const NameParams = Type.Object({
	name: Type.String({ description: "Extension name (its directory name)." }),
});

const LogsParams = Type.Object({
	name: Type.String({ description: "Extension name (its directory name)." }),
	since: Type.Optional(
		Type.Number({ description: "Only entries at or after this time (epoch ms)." }),
	),
});

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

const validationText = (name: string, result: ExtValidation) =>
	[
		result.ok
			? `${name}: valid (build ${result.build}; surfaces: ${
					result.surfaces.map((surface) => `${surface.id} [${surface.slot}]`).join(", ") || "none"
				})`
			: `${name}: invalid\n${result.errors.map((error) => `- ${error}`).join("\n")}`,
		...(result.logs.length > 0 ? [`dry-run log:\n${result.logs.join("\n")}`] : []),
	].join("\n");

const infoText = (info: ExtensionInfo) =>
	[
		`${info.name}: ${info.status} (generation ${info.generation ?? "none"}, build ${info.build ?? "none"})`,
		...(info.error ? [`error:\n${info.error}`] : []),
	].join("\n");

const logLine = (entry: ExtLogEntry) =>
	`${new Date(entry.at).toISOString()} ${entry.at} ${entry.level} ${entry.message}`;

export const promptSection = ({ docsPath, host }: { docsPath: string; host: DevHost }) => {
	const { user } = host.roots();
	return [
		"ThinkRail UI extensions: you can add panels, tabs, topbar items, tool cards, and chat message cards to this app.",
		`- Read the authoring guide before writing one: ${docsPath}`,
		`- Put an extension in ${user}/<name>/ or, in a trusted project, ${PROJECT_ROOT}/<name>/.`,
		"- Check with ext_validate, apply with ext_reload, debug with ext_logs.",
	].join("\n");
};

export const createExtDevTools =
	({ host, docsPath }: { host: DevHost; docsPath: string }): ExtensionFactory =>
	(pi: ExtensionAPI) => {
		pi.registerTool({
			name: "ext_validate",
			label: "Validate extension",
			description:
				"Dry-load a ThinkRail UI extension: checks extension.json, builds every view, and runs index.ts in a throwaway generation with a throwaway store. Never swaps the running version. Returns actionable errors and the dry run's tr.log lines.",
			parameters: NameParams,
			async execute(_id, { name }) {
				const result = await host.validate(name);
				const body = validationText(name, result);
				if (!result.ok) throw new Error(body);
				return { ...text(body), details: result };
			},
		});
		pi.registerTool({
			name: "ext_reload",
			label: "Reload extension",
			description:
				"Load a ThinkRail UI extension as the new running version (a new extension loads too). Returns status and errors; on failure the old version keeps running.",
			parameters: NameParams,
			async execute(_id, { name }) {
				const info = await host.reload(name);
				const body = infoText(info);
				if (info.status === "error") throw new Error(body);
				return { ...text(body), details: info };
			},
		});
		pi.registerTool({
			name: "ext_logs",
			label: "Extension logs",
			description:
				"Read a ThinkRail UI extension's log: tr.log output, load and build errors, and view errors reported by the browser. Each line starts with its time (ISO and epoch ms) for use as `since`.",
			parameters: LogsParams,
			async execute(_id, { name, since }) {
				const info = host.get(name);
				const entries = host.logs(name, since);
				if (!info && entries.length === 0) throw new Error(`extension "${name}" is not loaded`);
				const header = info ? infoText(info) : `${name}: not loaded`;
				const body = entries.length > 0 ? entries.map(logLine).join("\n") : "(no log entries)";
				return { ...text(`${header}\n${body}`), details: { count: entries.length } };
			},
		});
		pi.on("before_agent_start", (event) => {
			event.systemPromptOptions.sections[PROMPT_SECTION] = promptSection({ docsPath, host });
		});
	};
