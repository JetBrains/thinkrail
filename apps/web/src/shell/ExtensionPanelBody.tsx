import type { ExtensionCatalogEntry, ExtensionLayoutToolId } from "@thinkrail/contracts";
import type {
	PanelChatSession,
	PanelDeclaration,
	PanelHost,
	PanelProps,
	PanelToolCall,
} from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	type ReactNode,
	Suspense,
	useMemo,
} from "react";
import { ToolCallPreview } from "../chat/ToolCallPreview";
import { ErrorBoundary } from "../components/ErrorBoundary";
import {
	findExtensionPanel,
	findExtensionSideTool,
	findExtensionView,
	type RegisteredPanel,
	type RegisteredSideTool,
} from "../extensions";
import { openFileAtLine, openFileInTab } from "../panels/openTabs";
import { SettingsSection, selectWorkspaceById, useAppStore } from "../store";
import { supportsExtensionQuery } from "../transport";
import {
	APP_HOST_LINKS,
	createPanelHost,
	type ExtensionCatalogRead,
	openExtensionPanel,
	useExtensionCatalog,
} from "./extensionPanelHost";
import { leaveViewForCenter, openOwnView } from "./extensionViews";
import type { LayoutExtensionTab } from "./layout";
import { paletteNavigator } from "./paletteNavigation";
import { SessionChatView } from "./SessionChatView";

export type ExtensionPanelPlaceholderKind = "unsupported" | "missing" | "disabled" | "failed";

export type ExtensionPanelState<T extends { extension: string } = RegisteredPanel> =
	| { kind: "loading" }
	| { kind: ExtensionPanelPlaceholderKind }
	| { kind: "ready"; panel: T; entry: ExtensionCatalogEntry };

/** What an extension's panel or side tool shows: itself, or a placeholder; first match wins. */
export function extensionPanelState<T extends { extension: string }>(input: {
	panel: T | undefined;
	protocolVersion: number | null;
	disabled: readonly string[];
	catalog: ExtensionCatalogRead;
}): ExtensionPanelState<T> {
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

type PanelBody = Pick<PanelDeclaration, "title" | "load">;

const lazyPanels = new WeakMap<PanelBody, LazyExoticComponent<ComponentType<PanelProps>>>();

function lazyPanel(declaration: PanelBody): LazyExoticComponent<ComponentType<PanelProps>> {
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
	declaration: PanelBody;
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

/** `PanelHost.renderChat`: the session's live chat, hydrated on demand, in its own workspace. */
export function renderPanelChat(chat: PanelChatSession): ReactNode {
	return <SessionChatView workspaceId={chat.workspaceId} sessionId={chat.sessionId} />;
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

function useAppPanelHost({
	extension,
	workspaceId,
	projectId,
	apiVersion,
	protocolVersion,
}: {
	extension: string;
	workspaceId: string;
	projectId: string;
	apiVersion: number | undefined;
	protocolVersion: number | null;
}): PanelHost {
	return useMemo(
		() =>
			createPanelHost({
				...APP_HOST_LINKS,
				extension,
				openPanel: (id, params, title) => {
					const target = findExtensionPanel(extension, id);
					if (!target) return;
					leaveViewForCenter();
					openExtensionPanel(workspaceId, target, params, title);
				},
				renderToolCall: (call) => <PanelToolCallView call={call} />,
				renderChat: renderPanelChat,
				openFile: (target, path, line) => {
					leaveViewForCenter();
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
				openArtifacts: () => useAppStore.getState().requestToolView(workspaceId, "artifacts"),
				peek: (entry) => useAppStore.getState().requestPeek(workspaceId, entry),
				disabled: () => useAppStore.getState().disabledExtensions.includes(extension),
				openView: (view) => openOwnView(extension, view),
				scope: { workspaceId, projectId },
				hostProtocol: protocolVersion,
				hostApiVersion: apiVersion,
			}),
		[apiVersion, extension, projectId, protocolVersion, workspaceId],
	);
}

function LoadedExtensionPanel({
	workspaceId,
	projectId,
	tab,
	panel,
	entry,
	protocolVersion,
}: {
	workspaceId: string;
	projectId: string;
	tab: LayoutExtensionTab;
	panel: RegisteredPanel;
	entry: ExtensionCatalogEntry;
	protocolVersion: number | null;
}) {
	const host = useAppPanelHost({
		extension: panel.extension,
		workspaceId,
		projectId,
		apiVersion: entry.apiVersion,
		protocolVersion,
	});
	return (
		<ExtensionPanelFrame
			declaration={panel.declaration}
			host={host}
			params={tab.params}
			resetKeys={[workspaceId, tab.id]}
		/>
	);
}

const NO_PARAMS: Readonly<Record<string, string>> = {};

function LoadedSideTool({
	workspaceId,
	projectId,
	tool,
	entry,
	protocolVersion,
}: {
	workspaceId: string;
	projectId: string;
	tool: RegisteredSideTool;
	entry: ExtensionCatalogEntry;
	protocolVersion: number | null;
}) {
	const host = useAppPanelHost({
		extension: tool.extension,
		workspaceId,
		projectId,
		apiVersion: entry.apiVersion,
		protocolVersion,
	});
	return (
		<ExtensionPanelFrame
			declaration={tool.declaration}
			host={host}
			params={NO_PARAMS}
			resetKeys={[tool.id]}
		/>
	);
}

function ExtensionPlaceholderBody({
	state,
	onRetry,
}: {
	state: ExtensionPanelState<{ extension: string }>;
	onRetry: () => void;
}) {
	const t = useT();
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
			onRetry={onRetry}
		/>
	);
}

/** An extension's side tool in its pane: the active workspace's scope, or the panels' placeholders. */
export function ExtensionSideToolBody({
	workspaceId,
	toolId,
}: {
	workspaceId: string;
	toolId: ExtensionLayoutToolId;
}) {
	const tool = findExtensionSideTool(toolId);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const projectId = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.projectId ?? null,
	);
	const catalog = useExtensionCatalog(
		tool !== undefined && supportsExtensionQuery(protocolVersion),
	);
	const state = extensionPanelState({
		panel: tool,
		protocolVersion,
		disabled,
		catalog: catalog.read,
	});
	return (
		<div data-testid="extension-side-tool" data-tool={toolId} className="h-full min-h-0">
			{state.kind === "ready" && projectId !== null ? (
				<LoadedSideTool
					workspaceId={workspaceId}
					projectId={projectId}
					tool={state.panel}
					entry={state.entry}
					protocolVersion={protocolVersion}
				/>
			) : (
				<ExtensionPlaceholderBody state={state} onRetry={catalog.retry} />
			)}
		</div>
	);
}

export function ExtensionPanelBody({
	workspaceId,
	tab,
}: {
	workspaceId: string;
	tab: LayoutExtensionTab;
}) {
	const panel = findExtensionPanel(tab.extension, tab.panel);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const projectId = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.projectId ?? null,
	);
	const catalog = useExtensionCatalog(
		panel !== undefined && supportsExtensionQuery(protocolVersion),
	);
	const state = extensionPanelState({ panel, protocolVersion, disabled, catalog: catalog.read });
	if (state.kind === "ready" && projectId !== null) {
		return (
			<LoadedExtensionPanel
				workspaceId={workspaceId}
				projectId={projectId}
				tab={tab}
				panel={state.panel}
				entry={state.entry}
				protocolVersion={protocolVersion}
			/>
		);
	}
	return <ExtensionPlaceholderBody state={state} onRetry={catalog.retry} />;
}

/** A view's center: its panel in the active workspace's scope, or the panels' placeholders. */
export function ExtensionViewCenter({
	workspaceId,
	viewId,
}: {
	workspaceId: string;
	viewId: string;
}) {
	const view = findExtensionView(viewId);
	const panel = view ? findExtensionPanel(view.extension, view.declaration.center) : undefined;
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const projectId = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.projectId ?? null,
	);
	const catalog = useExtensionCatalog(
		panel !== undefined && supportsExtensionQuery(protocolVersion),
	);
	const state = extensionPanelState({ panel, protocolVersion, disabled, catalog: catalog.read });
	return (
		<div data-testid="extension-view-center" data-view={viewId} className="h-full min-h-0">
			{state.kind === "ready" && projectId !== null ? (
				<LoadedViewCenter
					workspaceId={workspaceId}
					projectId={projectId}
					panel={state.panel}
					entry={state.entry}
					protocolVersion={protocolVersion}
				/>
			) : (
				<ExtensionPlaceholderBody state={state} onRetry={catalog.retry} />
			)}
		</div>
	);
}

function LoadedViewCenter({
	workspaceId,
	projectId,
	panel,
	entry,
	protocolVersion,
}: {
	workspaceId: string;
	projectId: string;
	panel: RegisteredPanel;
	entry: ExtensionCatalogEntry;
	protocolVersion: number | null;
}) {
	const host = useAppPanelHost({
		extension: panel.extension,
		workspaceId,
		projectId,
		apiVersion: entry.apiVersion,
		protocolVersion,
	});
	return (
		<ExtensionPanelFrame
			declaration={panel.declaration}
			host={host}
			params={NO_PARAMS}
			resetKeys={[panel.extension, panel.panel]}
		/>
	);
}
