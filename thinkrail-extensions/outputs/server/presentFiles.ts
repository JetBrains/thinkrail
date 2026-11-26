import { isAbsolute } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { WorkspaceFiles } from "@thinkrail/extension-api/server";
import { type Static, Type } from "typebox";

export const PRESENT_FILES_TOOL_NAME = "present_files";

export const PresentFilesSchema = Type.Object({
	filepaths: Type.Array(
		Type.String({
			description: `A finished file for the user, inside the workspace's artifacts folder: worktree-relative (".thinkrail/context/report.md"), relative to the artifacts folder ("report.md") or absolute.`,
		}),
		{ minItems: 1, description: "The files to publish, most important first." },
	),
});

export type PresentFilesParams = Static<typeof PresentFilesSchema>;

export interface PresentFilesDetails {
	files: string[];
}

const DESCRIPTION =
	"Publish finished files you made for the user to the Outputs list of the Artifacts tab, where they open them; the chat shows each as a clickable card. Only files inside the workspace's artifacts folder can be published.";

const PROMPT_SNIPPET = "Publish finished files in the artifacts folder to the user's Outputs list";

function promptGuidelines(artifactsDir: string): string[] {
	return [
		`When a file you made for the user inside \`${artifactsDir}\` is ready — a report, a document, a mockup, a diagram, data they asked for — publish it with present_files before your final message. Publish only what the user should open: never scratch work, helpers, intermediate renders, scripts or the assets a deliverable loads (for an HTML mockup, publish the page, not its images or partial versions).`,
		`By default, save deliverables inside \`${artifactsDir}\`. If the user explicitly requested another persistent destination, keep the file there and link its actual path in your final message; do not call present_files for it or copy it just to publish it. present_files accepts only files inside \`${artifactsDir}\`.`,
		"A published file stays in Outputs and shows its latest version, so publish it again only when the user should look at it again.",
	];
}

function candidates(raw: string, artifactsDir: string): string[] {
	let path = raw.trim();
	if (path.startsWith("file://")) path = path.slice("file://".length);
	if (path.startsWith("@")) path = path.slice(1);
	if (isAbsolute(path)) return [path];
	const relative = path.replace(/^(?:\.[/\\])+/, "");
	return relative.startsWith(artifactsDir) ? [path] : [path, `${artifactsDir}${relative}`];
}

async function existsInWorkspace(
	path: string,
	cwd: string,
	files: WorkspaceFiles,
): Promise<boolean> {
	return files.check(path, cwd).then(
		() => true,
		() => false,
	);
}

export async function publishFiles(
	filepaths: readonly string[],
	cwd: string,
	files: WorkspaceFiles,
): Promise<PresentFilesDetails> {
	const tried = filepaths.map((raw) => candidates(raw, files.artifactsDir));
	const checks = await files.checkArtifacts(tried.flat(), cwd);
	const published = new Set<string>();
	const refused: string[] = [];
	let at = 0;
	for (const [index, paths] of tried.entries()) {
		const results = checks.slice(at, at + paths.length);
		at += paths.length;
		const accepted = results.find((check): check is { path: string } => "path" in check);
		if (accepted) {
			published.add(accepted.path);
			continue;
		}
		const errors = results.map((check) => ("error" in check ? check.error : ""));
		const [asGiven, inArtifacts] = paths;
		const elsewhere =
			inArtifacts !== undefined &&
			asGiven !== undefined &&
			(await existsInWorkspace(asGiven, cwd, files));
		refused.push(
			`- ${filepaths[index]}: ${(elsewhere ? errors[0] : errors.at(-1)) || "it cannot be published"}`,
		);
	}
	if (refused.length) {
		throw new Error(
			`present_files: nothing was published, because these paths cannot be:\n${refused.join("\n")}\nOnly files inside \`${files.artifactsDir}\` can be published. If the user explicitly requested another persistent destination, keep the file there and link its actual path in your final message; do not copy it just to publish it. Otherwise save the deliverable inside \`${files.artifactsDir}\` first. Retry present_files only with files inside the artifacts folder.`,
		);
	}
	return { files: [...published] };
}

export function publishedPaths(_args: unknown, details: unknown): string[] {
	if (typeof details !== "object" || details === null || !("files" in details)) return [];
	const { files } = details;
	return Array.isArray(files)
		? files.filter((file): file is string => typeof file === "string")
		: [];
}

export function createPresentFilesExtension(files: WorkspaceFiles): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name: PRESENT_FILES_TOOL_NAME,
			label: "Present Files",
			description: DESCRIPTION,
			promptSnippet: PROMPT_SNIPPET,
			promptGuidelines: promptGuidelines(files.artifactsDir),
			parameters: PresentFilesSchema,
			async execute(_toolCallId, params: PresentFilesParams, _signal, _onUpdate, ctx) {
				const details = await publishFiles(params.filepaths, ctx.cwd, files);
				const text = `Published to the user's Outputs: ${details.files.join(", ")}.`;
				return { content: [{ type: "text", text }], details };
			},
		});
	};
}
