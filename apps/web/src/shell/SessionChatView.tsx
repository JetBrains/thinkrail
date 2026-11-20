import type { PanelChatSession } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Suspense, useCallback, useEffect, useState } from "react";
import { hydrateSessionRuntime } from "../chat/useChatTodos";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { preloadedLazy } from "../components/preloadedLazy";
import { selectWorkspaceById, useAppStore } from "../store";
import { useKeybindingLabel } from "./keybindingState";

const ChatView = preloadedLazy(() => import("../chat/ChatView"));

const RESTORE_RETRY_DELAY_MS = 4000;

/**
 * A chat of any workspace, live and interactive, without switching to it: its runtime is hydrated on
 * demand, a slow restore offers Retry, and a file it links opens in its own workspace's Peek.
 */
export function SessionChatView({ workspaceId, sessionId }: PanelChatSession) {
	const t = useT();
	const landingChord = useKeybindingLabel("region.next");
	const available = useAppStore((state) => state.sessions[sessionId] !== undefined);
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const [stalled, setStalled] = useState(false);
	useEffect(() => {
		if (available || status !== "connected") return;
		setStalled(false);
		void hydrateSessionRuntime(workspaceId, sessionId).catch(() => {});
		const timer = setTimeout(() => setStalled(true), RESTORE_RETRY_DELAY_MS);
		return () => clearTimeout(timer);
	}, [available, connectionGeneration, workspaceId, sessionId, status]);
	const openFile = useCallback(
		(path: string) => {
			const state = useAppStore.getState();
			if (state.activeWorkspaceId !== workspaceId) {
				const target = selectWorkspaceById(state, workspaceId);
				if (!target) return;
				state.activateWorkspace(target);
			}
			useAppStore.getState().requestPeek(workspaceId, { kind: "file", path, sessionId });
		},
		[workspaceId, sessionId],
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
			data-testid="session-chat"
			data-session-id={sessionId}
			data-state={available ? "ready" : stalled ? "stalled" : "loading"}
			className="h-full min-h-0"
		>
			{available ? (
				<ErrorBoundary
					label={t("shell.sessionChat.label")}
					reportId="session-chat"
					resetKeys={[workspaceId, sessionId]}
				>
					<Suspense fallback={loading}>
						<ChatView
							key={sessionId}
							sessionId={sessionId}
							workspaceId={workspaceId}
							onOpenFile={openFile}
							landingChord={landingChord}
						/>
					</Suspense>
				</ErrorBoundary>
			) : stalled ? (
				<div className="flex h-full flex-col items-center justify-center gap-8 text-text-muted">
					<span className="tr-text-ui">{t("shell.workbench.chatRestoreSlow")}</span>
					<Button
						variant="outline"
						size="m"
						onClick={() => {
							setStalled(false);
							void hydrateSessionRuntime(workspaceId, sessionId).catch(() => {});
						}}
					>
						{t("common.retry")}
					</Button>
				</div>
			) : (
				loading
			)}
		</div>
	);
}
