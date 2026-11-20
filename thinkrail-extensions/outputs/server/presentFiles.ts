import { isAbsolute, relative, resolve, sep } from "node:path";
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

const PROMPT_SNIPPET = "Publish the finished files you made for the user to their Outputs list";

function promptGuidelines(artifactsDir: string): string[] {
	return [
		`When a file you made for the user is ready — a report, a document, a mockup, a diagram, data they asked for — publish it with present_files before your final message. Publish only what the user should open: never scratch work, helpers, intermediate renders, scripts or the assets a deliverable loads (for an HTML mockup, publish the page, not its images or partial versions).`,
		`present_files accepts only files inside \`${artifactsDir}\`; save a deliverable there first. A published file stays in Outputs and shows its latest version, so publish it again only when the user should look at it again.`,
	];
}

function posix(path: string): string {
	return sep === "/" ? path : path.split(sep).join("/");
}

function candidates(raw: string, cwd: string, artifactsDir: string): string[] {
	let path = raw.trim();
	if (path.startsWith("file://")) path = path.slice("file://".length);
	if (path.startsWith("@")) path = path.slice(1);
	if (isAbsolute(path)) return [posix(relative(cwd, path))];
	path = posix(path).replace(/^(?:\.\/)+/, "");
	return path.startsWith(artifactsDir) ? [path] : [path, `${artifactsDir}${path}`];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function resolvePublished(
	raw: string,
	cwd: string,
	files: WorkspaceFiles,
): Promise<{ path: string } | { error: string }> {
	let error = `it is not inside \`${files.artifactsDir}\``;
	for (const path of candidates(raw, cwd, files.artifactsDir)) {
		if (!path.startsWith(files.artifactsDir)) continue;
		try {
			await files.check(path, cwd);
			return { path };
		} catch (cause) {
			error = errorMessage(cause);
		}
	}
	return { error };
}

export async function publishFiles(
	filepaths: readonly string[],
	cwd: string,
	files: WorkspaceFiles,
): Promise<PresentFilesDetails> {
	const published = new Set<string>();
	const refused: string[] = [];
	for (const raw of filepaths) {
		const outcome = await resolvePublished(raw, resolve(cwd), files);
		if ("path" in outcome) published.add(outcome.path);
		else refused.push(`- ${raw}: ${outcome.error}`);
	}
	if (refused.length) {
		throw new Error(
			`present_files: nothing was published, because these paths cannot be:\n${refused.join("\n")}\nSave each deliverable inside \`${files.artifactsDir}\`, then call present_files again.`,
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
