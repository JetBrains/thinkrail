import {
	RiArrowGoBackLine as Back,
	RiArrowRightUpLine as OpenAsWorkspace,
	RiSparkling2Line as Sparkling,
	RiStackLine as Stack,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { type ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import { hydrateSessionRuntime } from "../chat/useChatTodos";
import { preloadedLazy } from "../components/preloadedLazy";
import {
	canJoinContainer,
	selectContainerGroup,
	selectContainerOrchestrator,
	selectLastContainerMember,
	selectWorkspaceById,
	selectWorkspaceContainerId,
	useAppStore,
	workspaceName,
} from "../store";
import { supportsContainers } from "../transport";

const ChatView = preloadedLazy(() => import("../chat/ChatView"));

const ORCHESTRATOR_RETRY_DELAY_MS = 4000;

function Notice({
	state,
	title,
	description,
	action,
}: {
	state: string;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div
			data-testid="orchestrator-tool"
			data-state={state}
			className="flex h-full flex-col items-center justify-center gap-8 p-16 text-center"
		>
			<Sparkling aria-hidden className="size-20 text-text-subtle" />
			<p className="tr-text-ui text-text-default">{title}</p>
			{description ? <p className="tr-text-metadata text-text-muted">{description}</p> : null}
			{action}
		</div>
	);
}

function StandaloneNotice({ workspace }: { workspace: Workspace | null }) {
	const t = useT();
	const canGroup = useAppStore(
		(state) =>
			workspace !== null &&
			canJoinContainer(workspace) &&
			supportsContainers(state.protocolVersion),
	);
	return (
		<Notice
			state="standalone"
			title={t("containers.orchestratorTool.standalone")}
			description={t("containers.orchestratorTool.standaloneDescription")}
			action={
				canGroup && workspace ? (
					<Button
						variant="outline"
						size="m"
						iconLeft={Stack}
						data-testid="orchestrator-tool-group"
						onClick={() =>
							useAppStore
								.getState()
								.openContainerDialog({ kind: "group", workspaceId: workspace.id })
						}
					>
						{t("containers.commands.group")}
					</Button>
				) : null
			}
		/>
	);
}

function OpenInCenterNotice({ containerId }: { containerId: string }) {
	const t = useT();
	const member = useAppStore((state) => {
		const group = selectContainerGroup(state, containerId);
		return group ? selectLastContainerMember(state, group) : null;
	});
	return (
		<Notice
			state="center"
			title={t("containers.orchestratorTool.inCenter")}
			action={
				member ? (
					<Button
						variant="outline"
						size="m"
						iconLeft={Back}
						data-testid="orchestrator-tool-back"
						onClick={() => useAppStore.getState().activateWorkspace(member)}
					>
						{t("containers.orchestratorTool.backTo", { name: workspaceName(t, member) })}
					</Button>
				) : null
			}
		/>
	);
}

function OrchestratorChat({
	orchestrator,
	sessionId,
	containerName,
	landingChord,
}: {
	orchestrator: Workspace;
	sessionId: string;
	containerName: string;
	landingChord: string;
}) {
	const t = useT();
	const orchestratorId = orchestrator.id;
	const available = useAppStore((state) => state.sessions[sessionId] !== undefined);
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const [stalled, setStalled] = useState(false);
	useEffect(() => {
		if (available || status !== "connected") return;
		setStalled(false);
		void hydrateSessionRuntime(orchestratorId, sessionId).catch(() => {});
		const timer = setTimeout(() => setStalled(true), ORCHESTRATOR_RETRY_DELAY_MS);
		return () => clearTimeout(timer);
	}, [available, connectionGeneration, orchestratorId, sessionId, status]);
	const openFile = useCallback(
		(path: string) => {
			const state = useAppStore.getState();
			const target = selectWorkspaceById(state, orchestratorId);
			if (!target) return;
			state.activateWorkspace(target);
			useAppStore.getState().requestPeek(orchestratorId, { kind: "file", path, sessionId });
		},
		[orchestratorId, sessionId],
	);
	const loading = (
		<LoadingRegion
			rows={8}
			label={t("shell.workbench.restoring.chat")}
			className="h-full overflow-hidden p-16"
		/>
	);
	return (
		<div
			data-testid="orchestrator-tool"
			data-state="chat"
			data-session-id={sessionId}
			className="flex h-full min-h-0 flex-col"
		>
			<div className="flex h-panel-header-row shrink-0 items-center gap-4 border-border-muted border-b px-8">
				<Stack aria-hidden className="size-14 shrink-0 text-text-muted" />
				<span
					data-testid="orchestrator-tool-container"
					className="min-w-0 truncate tr-text-ui text-text-default"
				>
					{containerName}
				</span>
				<span className="min-w-0 flex-1 truncate tr-text-metadata text-text-subtle">
					{t("containers.orchestratorTool.pinned")}
				</span>
				<IconButton
					size="s"
					icon={OpenAsWorkspace}
					label={t("containers.orchestratorTool.openAsWorkspace")}
					data-testid="orchestrator-tool-open"
					onClick={() => useAppStore.getState().activateWorkspace(orchestrator)}
				/>
			</div>
			<div className="min-h-0 flex-1">
				{available ? (
					<Suspense fallback={loading}>
						<ChatView
							key={sessionId}
							sessionId={sessionId}
							workspaceId={orchestratorId}
							onOpenFile={openFile}
							landingChord={landingChord}
						/>
					</Suspense>
				) : stalled ? (
					<div className="flex h-full flex-col items-center justify-center gap-8 text-text-muted">
						<span className="tr-text-ui">{t("shell.workbench.chatRestoreSlow")}</span>
						<Button
							variant="outline"
							size="m"
							onClick={() => {
								setStalled(false);
								void hydrateSessionRuntime(orchestratorId, sessionId).catch(() => {});
							}}
						>
							{t("common.retry")}
						</Button>
					</div>
				) : (
					loading
				)}
			</div>
		</div>
	);
}

/** The Orchestrator tool: the active workspace's container orchestrator chat, pinned across member switches. */
export function OrchestratorTool({
	workspaceId,
	landingChord,
}: {
	workspaceId: string;
	landingChord: string;
}) {
	const t = useT();
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const containerId = useAppStore((state) =>
		workspace ? selectWorkspaceContainerId(state, workspace) : null,
	);
	const container = useAppStore((state) =>
		containerId ? (state.containers[containerId] ?? null) : null,
	);
	const orchestrator = useAppStore((state) =>
		containerId ? selectContainerOrchestrator(state, containerId) : null,
	);
	const sessionId = container?.orchestratorSessionId ?? null;
	const deleted = useAppStore((state) =>
		orchestrator && sessionId
			? state.deletedSessionsByWorkspace[orchestrator.id]?.[sessionId] === true
			: false,
	);
	if (!container) return <StandaloneNotice workspace={workspace} />;
	if (orchestrator?.id === workspaceId) return <OpenInCenterNotice containerId={container.id} />;
	if (!orchestrator || !sessionId || deleted) {
		return (
			<Notice
				state="missing"
				title={t("containers.orchestratorTool.missing")}
				description={t("containers.orchestratorTool.missingDescription")}
			/>
		);
	}
	return (
		<OrchestratorChat
			orchestrator={orchestrator}
			sessionId={sessionId}
			containerName={container.name}
			landingChord={landingChord}
		/>
	);
}
