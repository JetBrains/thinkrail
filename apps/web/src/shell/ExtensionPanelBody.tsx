import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import type {
	PanelDeclaration,
	PanelHost,
	PanelProps,
	PanelToolCall,
	WebExtension,
} from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	Suspense,
	useMemo,
	useState,
} from "react";
import type { ChatPaneSlot } from "../chat/ChatPaneSplit";
import { ToolCallPreview } from "../chat/ToolCallPreview";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { findExtensionPanel, type RegisteredPanel } from "../extensions";
import { layoutResourceIdentity } from "../lib";
import { revealArtifactsListing } from "../panels/artifactActions";
import { openFileAtLine, openFileInTab } from "../panels/openTabs";
import {
	type ChatPanePanel,
	chatPaneViewKey,
	SettingsSection,
	selectChatPane,
	selectPanelViewState,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { getTransport, supportsExtensionQuery } from "../transport";
import { chatPanelActionId, moveChatPaneToTab } from "./extensionEntryPoints";
import {
	type ChatPaneHost,
	createPanelHost,
	type ExtensionCatalogRead,
	openExtensionPanel,
	useExtensionCatalog,
} from "./extensionPanelHost";
import type { LayoutExtensionTab } from "./layout";
import { paletteNavigator } from "./paletteNavigation";

export type ExtensionPanelPlaceholderKind = "unsupported" | "missing" | "disabled" | "failed";

export type ExtensionPanelState =
	| { kind: "loading" }
	| { kind: ExtensionPanelPlaceholderKind }
	| { kind: "ready"; panel: RegisteredPanel; entry: ExtensionCatalogEntry };

export function extensionPanelState(input: {
	panel: RegisteredPanel | undefined;
	protocolVersion: number | null;
	disabled: readonly string[];
	catalog: ExtensionCatalogRead;
}): ExtensionPanelState {
	const { panel, protocolVersion, catalog } = input;
	if (!panel) return { kind: "missing" };
	if (protocolVersion === null) return { kind: "loading" };
	if (!supportsExtensionQuery(protocolVersion)) return { kind: "unsupported" };
	if (input.disabled.includes(panel.extension)) return { kind: "disabled" };
	if (catalog === "loading" || catalog === "failed") return { kind: catalog };
	const entry = catalog.find((candidate) => candidate.name === panel.extension);
	return entry ? { kind: "ready", panel, entry } : { kind: "missing" };
}

const PLACEHOLDER_TEXT = {
	unsupported: "shell.extensionPanel.unsupported",
	missing: "shell.extensionPanel.missing",
	disabled: "shell.extensionPanel.disabled",
	failed: "shell.extensionPanel.catalogFailed",
} as const satisfies Record<ExtensionPanelPlaceholderKind, MessageKey>;

export function ExtensionPanelPlaceholder({
	kind,
	onOpenSettings,
	onRetry,
}: {
	kind: ExtensionPanelPlaceholderKind;
	onOpenSettings: () => void;
	onRetry: () => void;
}) {
	const t = useT();
	return (
		<div
			data-testid={`extension-panel-${kind}`}
			className="flex h-full flex-col items-center justify-center gap-8 p-16 text-center text-text-muted"
		>
			<span className="tr-text-ui">{t(PLACEHOLDER_TEXT[kind])}</span>
			{kind === "disabled" ? (
				<>
					<span className="tr-text-metadata">{t("shell.extensionPanel.disabledBody")}</span>
					<Button variant="outline" size="m" onClick={onOpenSettings}>
						{t("shell.extensionPanel.openSettings")}
					</Button>
				</>
			) : kind === "failed" ? (
				<Button variant="outline" size="m" onClick={onRetry}>
					{t("common.retry")}
				</Button>
			) : null}
		</div>
	);
}

const lazyPanels = new WeakMap<PanelDeclaration, LazyExoticComponent<ComponentType<PanelProps>>>();

function lazyPanel(declaration: PanelDeclaration): LazyExoticComponent<ComponentType<PanelProps>> {
	let component = lazyPanels.get(declaration);
	if (!component) {
		component = lazy(declaration.load);
		lazyPanels.set(declaration, component);
	}
	return component;
}

export function ExtensionPanelFrame({
	declaration,
	host,
	params,
	resetKeys,
}: {
	declaration: PanelDeclaration;
	host: PanelHost;
	params: Readonly<Record<string, string>>;
	resetKeys: readonly unknown[];
}) {
	const t = useT();
	const Panel = lazyPanel(declaration);
	return (
		<ErrorBoundary label={t(declaration.title)} reportId="extension-panel" resetKeys={resetKeys}>
			<Suspense
				fallback={
					<LoadingRegion
						rows={12}
						label={t("shell.extensionPanel.loading")}
						className="h-full overflow-hidden p-16"
					/>
				}
			>
				<div data-testid="extension-panel" className="h-full min-h-0">
					<Panel host={host} params={params} />
				</div>
			</Suspense>
		</ErrorBoundary>
	);
}

export function PanelToolCallView({ call }: { call: PanelToolCall }) {
	return (
		<ErrorBoundary
			label={call.toolName}
			reportId="extension-panel-tool-call"
			resetKeys={[call.toolCallId]}
		>
			<div data-testid="extension-panel-tool-call" data-tool={call.toolName}>
				<ToolCallPreview
					toolCallId={call.toolCallId}
					toolName={call.toolName}
					args={call.args}
					result={call.result}
					status={call.status}
					streaming={false}
				/>
			</div>
		</ErrorBoundary>
	);
}

interface LoadedPanelProps {
	workspaceId: string;
	projectId: string;
	panel: RegisteredPanel;
	entry: ExtensionCatalogEntry;
	protocolVersion: number | null;
	params: Readonly<Record<string, string>>;
	viewKey: string;
	pane: ChatPaneHost | undefined;
	resetKeys: readonly unknown[];
}

function LoadedExtensionPanel({
	workspaceId,
	projectId,
	panel,
	entry,
	protocolVersion,
	params,
	viewKey,
	pane,
	resetKeys,
}: LoadedPanelProps) {
	const extension = panel.extension;
	const apiVersion = entry.apiVersion;
	const [viewState] = useState(() =>
		selectPanelViewState(useAppStore.getState(), workspaceId, viewKey),
	);
	const host = useMemo(
		() =>
			createPanelHost({
				extension,
				request: (query) => getTransport().request("extension.query", query),
				navigate: (workspace, sessionId) =>
					void paletteNavigator.navigateToWorkspace(workspace, sessionId),
				locate: (location) =>
					void paletteNavigator
						.loadWorkspaceRow({ id: location.workspaceId, projectId: location.projectId })
						.then((ok) => {
							if (ok) useAppStore.getState().requestChatLocation(location);
						}),
				openPanel: (id, panelParams, title) => {
					const target = findExtensionPanel(extension, id);
					if (target) openExtensionPanel(workspaceId, target, panelParams, title);
				},
				renderToolCall: (call) => <PanelToolCallView call={call} />,
				openFile: (target, path, line) => {
					const open = () =>
						void (line === undefined
							? openFileInTab(target, path, "keep")
							: openFileAtLine(target, path, { line }, "keep"));
					const workspace = selectWorkspaceById(useAppStore.getState(), target);
					if (target === workspaceId || !workspace) {
						open();
						return;
					}
					void paletteNavigator
						.navigateToWorkspace({ id: workspace.id, projectId: workspace.projectId })
						.then((ok) => {
							if (ok) open();
						});
				},
				openArtifacts: () => revealArtifactsListing(workspaceId),
				scope: { workspaceId, projectId },
				hostProtocol: protocolVersion,
				hostApiVersion: apiVersion,
				pane,
				viewState,
				saveViewState: (state) =>
					useAppStore.getState().savePanelViewState(workspaceId, viewKey, state),
			}),
		[apiVersion, extension, pane, projectId, protocolVersion, viewKey, viewState, workspaceId],
	);
	return (
		<ExtensionPanelFrame
			declaration={panel.declaration}
			host={host}
			params={params}
			resetKeys={resetKeys}
		/>
	);
}

export interface ExtensionPanelGate {
	readonly state: ExtensionPanelState;
	readonly projectId: string | null;
	readonly protocolVersion: number | null;
	readonly retry: () => void;
}

/** The tab body's and the chat pane's one gate: what to show for this panel right now. */
export function useExtensionPanelGate(
	workspaceId: string,
	extension: string | undefined,
	panelId: string | undefined,
	extensions?: readonly WebExtension[],
): ExtensionPanelGate {
	const panel =
		extension === undefined || panelId === undefined
			? undefined
			: findExtensionPanel(extension, panelId, extensions);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const projectId = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.projectId ?? null,
	);
	const catalog = useExtensionCatalog(
		panel !== undefined && supportsExtensionQuery(protocolVersion),
	);
	return {
		state: extensionPanelState({ panel, protocolVersion, disabled, catalog: catalog.read }),
		projectId,
		protocolVersion,
		retry: catalog.retry,
	};
}

/** A pane beside a chat shows only while its panel is openable; a tab shows every state. */
export function chatPaneShown(state: ExtensionPanelState): boolean {
	return state.kind === "ready" || state.kind === "loading" || state.kind === "failed";
}

export function GatedExtensionPanel({
	workspaceId,
	gate,
	params,
	viewKey,
	pane,
	resetKeys,
}: {
	workspaceId: string;
	gate: ExtensionPanelGate;
	params: Readonly<Record<string, string>>;
	viewKey: string;
	pane?: ChatPaneHost | undefined;
	resetKeys: readonly unknown[];
}) {
	const t = useT();
	const { state, projectId } = gate;
	if (state.kind === "ready" && projectId !== null) {
		return (
			<LoadedExtensionPanel
				workspaceId={workspaceId}
				projectId={projectId}
				panel={state.panel}
				entry={state.entry}
				protocolVersion={gate.protocolVersion}
				params={params}
				viewKey={viewKey}
				pane={pane}
				resetKeys={resetKeys}
			/>
		);
	}
	if (state.kind === "ready" || state.kind === "loading") {
		return (
			<LoadingRegion
				rows={12}
				label={t("shell.extensionPanel.loading")}
				testId="extension-panel-loading"
				className="h-full overflow-hidden p-16"
			/>
		);
	}
	return (
		<ExtensionPanelPlaceholder
			kind={state.kind}
			onOpenSettings={() => useAppStore.getState().openSettings(SettingsSection.Extensions)}
			onRetry={gate.retry}
		/>
	);
}

export function ExtensionPanelBody({
	workspaceId,
	tab,
}: {
	workspaceId: string;
	tab: LayoutExtensionTab;
}) {
	const gate = useExtensionPanelGate(workspaceId, tab.extension, tab.panel);
	return (
		<GatedExtensionPanel
			workspaceId={workspaceId}
			gate={gate}
			params={tab.params}
			viewKey={layoutResourceIdentity(tab)}
			resetKeys={[workspaceId, tab.id]}
		/>
	);
}

export function ExtensionChatPaneBody({
	workspaceId,
	sessionId,
	pane,
	extensions,
}: {
	workspaceId: string;
	sessionId: string;
	pane: ChatPanePanel;
	extensions?: readonly WebExtension[] | undefined;
}) {
	const gate = useExtensionPanelGate(workspaceId, pane.extension, pane.panel, extensions);
	const projectId = gate.projectId;
	const panel = gate.state.kind === "ready" ? gate.state.panel : undefined;
	const paneHost = useMemo<ChatPaneHost | undefined>(
		() =>
			panel && projectId !== null
				? {
						chat: { projectId, workspaceId, sessionId },
						reveal: (location) => useAppStore.getState().requestChatLocation(location),
						openAsTab: () => moveChatPaneToTab(panel, { workspaceId, sessionId }),
						closePane: () => useAppStore.getState().closeChatPane(workspaceId, sessionId),
					}
				: undefined,
		[panel, projectId, sessionId, workspaceId],
	);
	return (
		<GatedExtensionPanel
			workspaceId={workspaceId}
			gate={gate}
			params={pane.params}
			viewKey={chatPaneViewKey(sessionId, pane.extension, pane.panel)}
			pane={paneHost}
			resetKeys={[workspaceId, sessionId, pane.extension, pane.panel]}
		/>
	);
}

/** What `ChatView` shows beside this chat: its open pane while the panel is openable, else nothing. */
export function useExtensionChatPane(
	workspaceId: string,
	sessionId: string,
	extensions?: readonly WebExtension[],
): ChatPaneSlot | undefined {
	const t = useT();
	const pane = useAppStore((state) => selectChatPane(state, workspaceId, sessionId));
	const open = pane?.open === true ? pane : null;
	const gate = useExtensionPanelGate(workspaceId, open?.extension, open?.panel, extensions);
	const title = open
		? findExtensionPanel(open.extension, open.panel, extensions)?.declaration.title
		: undefined;
	const label = title ? t(title) : "";
	const shown = open !== null && chatPaneShown(gate.state);
	return useMemo(
		() =>
			shown && open
				? {
						id: chatPanelActionId(open),
						label,
						width: open.width,
						content: (
							<ExtensionChatPaneBody
								key={chatPaneViewKey(sessionId, open.extension, open.panel)}
								workspaceId={workspaceId}
								sessionId={sessionId}
								pane={open}
								extensions={extensions}
							/>
						),
						onWidthChange: (width: number) =>
							useAppStore.getState().setChatPaneWidth(workspaceId, sessionId, width),
						onClose: () => useAppStore.getState().closeChatPane(workspaceId, sessionId),
					}
				: undefined,
		[extensions, label, open, sessionId, shown, workspaceId],
	);
}
