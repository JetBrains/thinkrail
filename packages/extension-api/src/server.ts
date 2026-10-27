import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type ToolResponse =
	| { kind: "response"; value: unknown }
	| { kind: "deferred" }
	| { kind: "abandoned" };

export interface ExtensionSessionServices {
	expectToolResponse(toolCallId: string): void;
	awaitToolResponse(toolCallId: string, signal: AbortSignal | undefined): Promise<ToolResponse>;
}

export interface InteractiveTool {
	describeResponse?: (args: unknown, response: unknown) => string | undefined;
}

export interface ServerExtension {
	name: string;
	title?: string;
	description?: string;
	extensions: ExtensionFactory[];
	sessionExtensions?: (session: ExtensionSessionServices) => ExtensionFactory[];
	interactiveTools?: Record<string, InteractiveTool>;
	childExtensions?: ExtensionFactory[];
	skillPackages?: string[];
}

export function defineServerExtension<T extends ServerExtension>(extension: T): T {
	return extension;
}
