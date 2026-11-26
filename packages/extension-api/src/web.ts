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
	focusTranscript: () => void;
	mayClaimFocus: () => boolean;
	landingChord: string;
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

export type ComposerSuggestionsReader = (
	args: Record<string, unknown>,
	result: unknown,
) => readonly string[];

export interface ToolRegistrationOptions {
	summary?: ToolSummary;
	chrome?: ToolChrome;
	prominence?: ToolProminence;
	width?: ToolWidth;
	defaultExpanded?: boolean;
	interactive?: boolean;
	dock?: boolean;
	composerSuggestions?: ComposerSuggestionsReader;
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
	readonly scope?: string;
	readonly chords: readonly ExtensionChord[];
}

export interface ExtensionShortcut {
	readonly id: string;
	readonly title: MessageKey;
	readonly keys: readonly [ExtensionShortcutKey, ...ExtensionShortcutKey[]];
}

export type PanelScope = "project" | "session";

/** A place inside a chat: a message of the host's display projection, optionally a tool call in it. */
export interface PanelChatAnchor {
	messageIndex: number;
	anchorText: string;
	toolCallId?: string | undefined;
	/** The anchor is the nearest shown ancestor of what the panel points at; the chat says so. */
	approximate?: boolean | undefined;
}

export interface PanelChatTarget {
	projectId: string;
	workspaceId: string;
	sessionId: string;
	at?: PanelChatAnchor | undefined;
}

/** A recorded tool call for `PanelHost.renderToolCall`; `result` has the chat's `{ content, details }` shape. */
export interface PanelToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: "done" | "error";
}

export interface PanelHostScope {
	workspaceId: string;
	projectId: string;
}

/** Where a panel shows: its own center tab, or a pane beside its chat inside the chat's tab. */
export type PanelPlacement = "tab" | "chatPane";

export interface PanelHost {
	/** `extension.query` for this panel's own extension; rejects with the host's coded errors; an aborted signal rejects locally only. */
	query(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown>;
	openChat(target: PanelChatTarget): void;
	/** Where this panel shows; absent means a center tab. */
	readonly placement?: PanelPlacement;
	/** In a chat pane: reveals a place in the chat beside the pane, in place — no tab switch, focus stays in the pane. */
	showInChat?(at: PanelChatAnchor): void;
	/** In a chat pane: moves the panel, with its view state, to its own center tab and closes the pane. */
	openAsTab?(): void;
	/** In a chat pane: closes the pane, giving the chat its full width back. */
	closePane?(): void;
	/** The view state this panel last saved for its tab or pane (`saveViewState`), `undefined` the first time. */
	readonly viewState?: unknown;
	/** Keeps a JSON-like view state for this tab or pane in the host, so a remount (the tab brought back) restores it. */
	saveViewState?(state: unknown): void;
	/** Opens, or focuses, another panel of this extension in a center tab of `scope`'s workspace; `title` names the tab. */
	openPanel(panel: string, params?: Readonly<Record<string, string>>, title?: string): void;
	/** The chat's own renderer for the tool (edit → diff, bash → command and output), without chat chrome. */
	renderToolCall(call: PanelToolCall): ReactNode;
	/** Opens a workspace file in a center tab, at `line` when given; `path` is relative to the workspace. */
	openFile(workspaceId: string, path: string, line?: number): void;
	/** Reveals the Artifacts tool of `scope`'s workspace, where files an extension wrote there show; absent on a host without one. */
	openArtifacts?(): void;
	readonly scope: PanelHostScope;
	readonly hostProtocol: number | null;
	readonly hostApiVersion: number | undefined;
}

export interface PanelProps {
	host: PanelHost;
	params: Readonly<Record<string, string>>;
}

/** The panel opens *for a chat*: from the chat's header, its tab's menu and the chat lists' menus. */
export interface PanelChatAction {
	/** The header's link beside the chat's usage figures; the panel's `title` where absent. */
	label?: MessageKey;
	/** The item in a chat's menus, worded as what it does. */
	menuLabel: MessageKey;
	/** The panel's params for that chat (never with `at`). */
	params: (chat: PanelChatTarget) => Readonly<Record<string, string>>;
}

/** The panel's icon in the left rail's footer, in a workspace and on Project Home. */
export interface PanelRail {
	/** The icon's name and tooltip; the panel's `title` where absent. */
	label?: MessageKey;
	/** The id of one of the extension's global `commands`: its chord opens the panel instead of reaching the overlay. */
	command?: string;
}

export interface PanelDeclaration {
	title: MessageKey;
	/** Space-separated words the panel's entry points also match, translated like the title. */
	keywords?: MessageKey;
	icon: ComponentType<{ className?: string | undefined }>;
	scopes: readonly PanelScope[];
	chatAction?: PanelChatAction;
	/** With a `chatAction`: the panel opens beside an open chat, inside the chat's tab, rather than in a tab of its own. */
	chatPane?: true;
	/** A wide view: opening it, as a tab or a chat pane, hides the side and bottom panes once. */
	wide?: true;
	rail?: PanelRail;
	load: () => Promise<{ default: ComponentType<PanelProps> }>;
}

export interface WebExtension {
	name: string;
	title?: MessageKey;
	description?: MessageKey;
	toolRenderers?: Record<string, { renderer: ToolRenderer; options?: ToolRegistrationOptions }>;
	globalOverlay?: ComponentType<GlobalOverlayProps>;
	commands?: readonly ExtensionCommand[];
	shortcuts?: readonly ExtensionShortcut[];
	panels?: Record<string, PanelDeclaration>;
}

export function defineWebExtension<T extends WebExtension>(extension: T): T {
	return extension;
}
