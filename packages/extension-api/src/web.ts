import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { ComponentType, ReactNode } from "react";

export { languageFromPath, numArg, resultText, strArg } from "./toolHelpers";
export {
	type ParsedToolResultContent,
	parseToolResultContent,
	toolValueText,
} from "./toolResultContent";

export type ToolStatus = "running" | "done" | "error";

export type ToolPlacement = "dock" | "stub";

export interface ToolInteractionState<R = unknown> {
	response?: R | undefined;
	superseded: boolean;
	ended: boolean;
	accepting: boolean;
}

export interface ToolInteraction<R = unknown> {
	state: ToolInteractionState<R>;
	respond: (response: R) => Promise<void>;
	focusScope: object;
	prepareLayoutChange: (
		anchor: () => HTMLElement | null,
		provenance?: "user" | "automatic",
	) => () => void;
	focusComposer: () => void;
	hostProtocol?: number | undefined;
	placement?: ToolPlacement | undefined;
}

export interface ToolRenderProps {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: ToolStatus;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	streaming: boolean;
	interaction?: ToolInteraction | undefined;
}

export type ToolChrome = "card" | "bare";

export type ToolProminence = "routine" | "primary";

export type ToolWidth = "column" | "content";

export type ToolRenderer = (props: ToolRenderProps) => ReactNode;

export type ToolSummary = (props: ToolRenderProps, t: Translator) => string;

export interface ToolRegistrationOptions {
	summary?: ToolSummary;
	chrome?: ToolChrome;
	prominence?: ToolProminence;
	width?: ToolWidth;
	defaultExpanded?: boolean;
	interactive?: boolean;
	dock?: boolean;
}

export interface GlobalOverlayProps {
	isTextEntry: (target: EventTarget | null) => boolean;
	activeLayer: () => ParentNode;
	platform: string;
	onCommand: (listener: (id: string) => void) => () => void;
	matchCommand: (event: KeyboardEvent) => string | null;
	claimKeyboard: (active: boolean) => void;
}

export interface ExtensionChord {
	readonly code: string;
	readonly key: string;
	readonly mod?: boolean;
	readonly ctrl?: boolean;
	readonly alt?: boolean;
	readonly shift?: boolean;
}

export type ExtensionShortcutKey = ExtensionChord;

export interface ExtensionCommand {
	readonly id: string;
	readonly title: MessageKey;
	readonly chords: readonly ExtensionChord[];
}

export interface ExtensionShortcut {
	readonly id: string;
	readonly title: MessageKey;
	readonly keys: readonly [ExtensionShortcutKey, ...ExtensionShortcutKey[]];
}

export interface WebExtension {
	name: string;
	title?: MessageKey;
	description?: MessageKey;
	toolRenderers?: Record<string, { renderer: ToolRenderer; options?: ToolRegistrationOptions }>;
	globalOverlay?: ComponentType<GlobalOverlayProps>;
	commands?: readonly ExtensionCommand[];
	shortcuts?: readonly ExtensionShortcut[];
}

export function defineWebExtension<T extends WebExtension>(extension: T): T {
	return extension;
}
