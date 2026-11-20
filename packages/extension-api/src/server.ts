import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type ToolResponse =
	| { kind: "response"; value: unknown }
	| { kind: "deferred" }
	| { kind: "abandoned" };

export interface WorkspaceFiles {
	check(path: string, cwd: string): Promise<void>;
	checkArtifact(path: string, cwd: string): Promise<string>;
	ensureArtifactsDir(cwd: string): Promise<void>;
	scratchDir: string;
	artifactsDir: string;
}

export interface ExtensionSessionServices {
	expectToolResponse(toolCallId: string): void;
	awaitToolResponse(toolCallId: string, signal: AbortSignal | undefined): Promise<ToolResponse>;
	setting(key: string): boolean;
	workspaceFiles: WorkspaceFiles;
}

export interface ExtensionBooleanSetting {
	type: "boolean";
	default: boolean;
}

export type ExtensionSetting = ExtensionBooleanSetting;

export interface InteractiveTool {
	describeResponse?: (args: unknown, response: unknown) => string | undefined;
}

export interface ArtifactTool {
	presented?: (args: unknown, details: unknown) => readonly string[];
	picked?: (args: unknown, details: unknown) => readonly string[];
	published?: (args: unknown, details: unknown) => readonly string[];
}

export interface ServerExtension {
	name: string;
	title?: string;
	description?: string;
	extensions: ExtensionFactory[];
	sessionExtensions?: (session: ExtensionSessionServices) => ExtensionFactory[];
	interactiveTools?: Record<string, InteractiveTool>;
	artifactTools?: Record<string, ArtifactTool>;
	settings?: Record<string, ExtensionSetting>;
	childExtensions?: ExtensionFactory[];
	skillPackages?: string[];
}

export function defineServerExtension<T extends ServerExtension>(extension: T): T {
	return extension;
}
