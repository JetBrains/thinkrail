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

/** A chat `PanelHost.renderChat` shows: one session of a workspace, which may be another than `scope`'s. */
export interface PanelChatSession {
	workspaceId: string;
	sessionId: string;
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

/** A workspace to switch to, optionally on one of its chats and showing an entry in its Peek. */
export interface PanelWorkspaceTarget {
	workspaceId: string;
	projectId: string;
	sessionId?: string | undefined;
	/** Shown in the target workspace's Peek, as `PanelHost.peek` shows one in `scope`'s. */
	peek?: PanelPeekEntry | undefined;
	/** A built-in tool of the target workspace to reveal: its Review (the comments on its diff). */
	reveal?: "review" | undefined;
}

/** What `PanelHost.peek` shows in Peek: a panel of the caller's own extension, or a file or two of `scope`'s workspace. */
export type PanelPeekEntry =
	| {
			kind: "extension";
			panel: string;
			params?: Readonly<Record<string, string>> | undefined;
			/** The crumb's name; the panel's `title` where absent. */
			title?: string | undefined;
	  }
	| { kind: "file"; path: string; line?: number | undefined }
	| { kind: "compare"; before: string; after: string };

/** An `extension.event` payload the extension's server half published with `host.publish`. */
export type PanelEventListener = (payload: unknown) => void;

export interface PanelHost {
	/** `extension.query` for this panel's own extension; rejects with the host's coded errors; an aborted signal rejects locally only. */
	query(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown>;
	openChat(target: PanelChatTarget): void;
	/** Opens, or focuses, another panel of this extension in a center tab of `scope`'s workspace; `title` names the tab. */
	openPanel(panel: string, params?: Readonly<Record<string, string>>, title?: string): void;
	/** The chat's own renderer for the tool (edit → diff, bash → command and output), without chat chrome. */
	renderToolCall(call: PanelToolCall): ReactNode;
	/** The session's live, interactive chat (transcript, questions, composer), loaded on demand; no workspace switch. */
	renderChat(chat: PanelChatSession): ReactNode;
	/** Opens a workspace file in a center tab, at `line` when given; `path` is relative to the workspace. */
	openFile(workspaceId: string, path: string, line?: number): void;
	/** Reveals the Artifacts tool of `scope`'s workspace, where files an extension wrote there show; absent on a host without one. */
	openArtifacts?(): void;
	/** Switches to another workspace (on one of its chats, showing `peek` there, when given); every panel follows the switch. */
	openWorkspace(target: PanelWorkspaceTarget): void;
	/** Shows the entry in `scope`'s workspace's Peek, the contextual pane at the workbench's right edge. */
	peek(entry: PanelPeekEntry): void;
	/**
	 * Listens to this extension's `extension.event`s of `type`; returns the unsubscribe. Only events published
	 * after the call arrive; none below the host's gate or while the extension is switched off.
	 */
	onEvent(type: string, listener: PanelEventListener): () => void;
	/** Enters this extension's view `view` (its `views` entry); nothing without a workspace or for an unknown view. */
	openView(view: string): void;
	readonly scope: PanelHostScope;
	readonly hostProtocol: number | null;
	readonly hostApiVersion: number | undefined;
}

/**
 * A status item's host: a `PanelHost`'s reads and navigation for its own extension. `scope` is the active
 * workspace and its project, `null` on Project Home and Welcome, where `peek` shows nothing.
 */
export type StatusItemHost = Pick<
	PanelHost,
	| "query"
	| "onEvent"
	| "openChat"
	| "openWorkspace"
	| "peek"
	| "openView"
	| "hostProtocol"
	| "hostApiVersion"
> & { readonly scope: PanelHostScope | null };

export interface StatusItemProps {
	host: StatusItemHost;
}

/** A compact readout in the topbar's action cluster; it renders nothing while it has nothing to say. */
export interface StatusItemDeclaration {
	load: () => Promise<{ default: ComponentType<StatusItemProps> }>;
}

export interface ContainerSectionProps {
	/** A status item's host: its `scope` is the active workspace, whose Peek shows the container. */
	host: StatusItemHost;
	containerId: string;
}

/** A section of a container's overview in Peek: the extension's facts about that container; it renders nothing while it has none. */
export interface ContainerSectionDeclaration {
	load: () => Promise<{ default: ComponentType<ContainerSectionProps> }>;
}

/**
 * A view: the whole workbench given to the extension until the user goes back — its panel in place of the
 * center, its side tools on the left and in the bottom panel, Peek open on the right. The shell keeps the
 * workbench it replaced and restores it exactly.
 */
export interface ViewDeclaration {
	/** The view's name, "Board view"; the rail toggle and the Enter / Exit commands are worded from it. */
	title: MessageKey;
	icon: ComponentType<{ className?: string | undefined }>;
	/** One of the extension's `panels`, shown in place of the workspace's center groups. */
	center: string;
	/** One of the extension's `sideTools`, in a pane of its own leading the left side. */
	left?: string;
	/** One of the extension's `sideTools`, in a pane of its own leading the bottom panel. */
	bottom?: string;
	/** The left side's width and the bottom panel's height, workbench-wide ratios. */
	layout?: { leftWidth?: number; bottomHeight?: number };
	/** What Peek says while it shows nothing. */
	peekEmpty?: MessageKey;
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
	rail?: PanelRail;
	load: () => Promise<{ default: ComponentType<PanelProps> }>;
}

/** A singleton side tool: the layout's tool `ext:<extension>:<id>`, in the rails like Files or Review. */
export interface SideToolDeclaration {
	title: MessageKey;
	icon: ComponentType<{ className?: string | undefined }>;
	/** Where its rail entry waits until placed, and where its first reveal opens a pane. */
	defaultSide: "left" | "right";
	/** Its body; its `PanelHost.scope` is the active workspace and its project, and `params` is empty. */
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
	sideTools?: Record<string, SideToolDeclaration>;
	statusItems?: Record<string, StatusItemDeclaration>;
	containerSections?: Record<string, ContainerSectionDeclaration>;
	views?: Record<string, ViewDeclaration>;
}

export function defineWebExtension<T extends WebExtension>(extension: T): T {
	return extension;
}
