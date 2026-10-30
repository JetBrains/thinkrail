import {
	RiAddLine as Plus,
	RiRestartLine as Restart,
	RiRobot2Line as Robot,
} from "@remixicon/react";
import type { RunExecution, TerminalTabsPush } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { i18n, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { terminalName } from "../lib";
import type { TerminalTab } from "../store";
import { isConnectedGeneration, isLiveRun, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { statusChip } from "./runActions";
import { useRunRunner } from "./useRunRunner";

const TerminalInstance = lazy(() => import("./TerminalInstance"));

export function useTerminalCatalog(workspaceId: string | null): boolean {
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const status = useAppStore((state) => state.status);
	const [readyFor, setReadyFor] = useState<string | null>(null);
	const pushEpochByWorkspace = useRef(new Map<string, number>());
	useEffect(
		() =>
			getTransport().subscribe(WS_CHANNELS.terminalTabs, (payload) => {
				const event = payload as TerminalTabsPush;
				pushEpochByWorkspace.current.set(
					event.workspaceId,
					(pushEpochByWorkspace.current.get(event.workspaceId) ?? 0) + 1,
				);
				useAppStore.getState().setWorkspaceTerminals(event.workspaceId, event.tabs);
			}),
		[],
	);

	useEffect(() => {
		setReadyFor(null);
		if (!workspaceId || status !== "connected" || connectionGeneration === 0) return;
		let current = true;
		const pushEpoch = pushEpochByWorkspace.current.get(workspaceId) ?? 0;
		void getTransport()
			.request("terminal.list", { workspaceId })
			.then(({ tabs }) => {
				const state = useAppStore.getState();
				if (
					!current ||
					!isConnectedGeneration(state, connectionGeneration) ||
					state.removedWorkspaceIds[workspaceId]
				) {
					return;
				}
				if ((pushEpochByWorkspace.current.get(workspaceId) ?? 0) !== pushEpoch) {
					setReadyFor(workspaceId);
					return;
				}
				state.setWorkspaceTerminals(workspaceId, tabs);
				setReadyFor(workspaceId);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [connectionGeneration, status, workspaceId]);
	return readyFor === workspaceId;
}

const FOOTER_CHIP: Record<ReturnType<typeof statusChip>["tone"], string> = {
	neutral: "bg-control-bg-selected text-text-muted",
	success: "bg-feedback-success-subtle text-feedback-success",
	warning: "bg-feedback-warning-subtle text-feedback-warning",
	info: "bg-feedback-info-subtle text-feedback-info",
};

function RunTerminalFooter({
	workspaceId,
	execution,
}: {
	workspaceId: string;
	execution: RunExecution;
}) {
	const t = useT();
	const runner = useRunRunner(workspaceId, null);
	const chip = statusChip(t, execution);
	return (
		<div
			data-testid="run-terminal-footer"
			data-status={execution.status}
			className="absolute right-0 bottom-0 left-0 z-10 flex h-32 items-center justify-between gap-8 border-border-muted border-t bg-container-elevated-bg px-12"
		>
			<span
				className={cn(
					"inline-flex h-20 items-center gap-4 whitespace-nowrap rounded-full px-8 tr-text-emphasis",
					FOOTER_CHIP[chip.tone],
				)}
			>
				{chip.label}
			</span>
			<span className="flex items-center gap-6">
				<Button
					variant="outline"
					size="s"
					iconLeft={Robot}
					data-testid="run-terminal-fix"
					onClick={() => runner.run({ kind: "fix", execution })}
				>
					{t("panels.run.fix.label")}
				</Button>
				<Button
					size="s"
					iconLeft={Restart}
					data-testid="run-terminal-again"
					onClick={() => runner.run({ kind: "start", targetId: execution.targetId, prepare: true })}
				>
					{t("panels.run.footer.runAgain")}
				</Button>
			</span>
		</div>
	);
}

export function TerminalWorkbenchBody({ tab, onAdd }: { tab: TerminalTab; onAdd: () => void }) {
	const t = useT();
	const execution = useAppStore((state) =>
		tab.kind === "command"
			? (state.runByWorkspace[tab.workspaceId]?.executions.find(
					(candidate) => candidate.tabKey === tab.tabKey,
				) ?? null)
			: null,
	);
	const ended = execution !== null && !isLiveRun(execution);
	return (
		<div data-testid="terminal-panel" className="relative h-full min-h-0 bg-container-terminal-bg">
			<IconButton
				variant="outline"
				size="s"
				icon={Plus}
				label={t("panels.terminalWorkbench.newTerminal")}
				data-testid="terminal-add"
				onClick={onAdd}
				className="absolute top-4 right-4 z-10"
			/>
			<div className={cn("absolute inset-0", ended && "bottom-32")}>
				<Suspense fallback={null}>
					<TerminalInstance
						tabKey={tab.tabKey}
						workspaceId={tab.workspaceId}
						{...(tab.initialCommand ? { initialCommand: tab.initialCommand } : {})}
						{...(tab.kind === "command" ? { runGeneration: execution?.runId ?? null } : {})}
					/>
				</Suspense>
			</div>
			{ended ? <RunTerminalFooter workspaceId={tab.workspaceId} execution={execution} /> : null}
		</div>
	);
}

interface PendingTerminalClose {
	tab: TerminalTab;
	onClosed: () => void;
}

interface TerminalCloseState {
	request: PendingTerminalClose;
	phase: "requesting" | "confirming" | "forcing";
}

export function useTerminalClose(): {
	requestClose: (tab: TerminalTab, onClosed: () => void) => void;
	confirmation: ReactNode;
} {
	const t = useT();
	const [closeState, setCloseState] = useState<TerminalCloseState | null>(null);
	const completed = useRef(new WeakSet<PendingTerminalClose>());
	const activeRequest = useRef<PendingTerminalClose | null>(null);
	const forceSubmitted = useRef<PendingTerminalClose | null>(null);
	const finish = useCallback((request: PendingTerminalClose, accepted: boolean) => {
		if (completed.current.has(request)) return;
		completed.current.add(request);
		if (activeRequest.current === request) activeRequest.current = null;
		if (forceSubmitted.current === request) forceSubmitted.current = null;
		if (accepted) {
			useAppStore.getState().closeTerminalTab(request.tab.workspaceId, request.tab.tabKey, false);
			request.onClosed();
		}
		setCloseState((current) => (current?.request === request ? null : current));
	}, []);
	const fail = useCallback((request: PendingTerminalClose, error: unknown) => {
		if (completed.current.has(request)) return;
		completed.current.add(request);
		if (activeRequest.current === request) activeRequest.current = null;
		if (forceSubmitted.current === request) forceSubmitted.current = null;
		setCloseState((current) => (current?.request === request ? null : current));
		if (!useAppStore.getState().removedWorkspaceIds[request.tab.workspaceId]) {
			toast.error(errorText(error), i18n.t("panels.terminalWorkbench.closeFailed"));
		}
	}, []);
	const pending = closeState?.phase === "confirming" ? closeState.request : null;
	useEffect(() => {
		if (!closeState) return;
		const clearIfGone = () => {
			const { request, phase } = closeState;
			const terminals = useAppStore.getState().terminalsByWorkspace[request.tab.workspaceId] ?? [];
			if (!terminals.some((terminal) => terminal.tabKey === request.tab.tabKey)) {
				finish(request, phase !== "confirming");
			}
		};
		clearIfGone();
		return useAppStore.subscribe(clearIfGone);
	}, [closeState, finish]);
	const close = useCallback(
		(request: PendingTerminalClose, force: boolean) => {
			if (completed.current.has(request)) return;
			if (activeRequest.current && activeRequest.current !== request) return;
			activeRequest.current = request;
			setCloseState({ request, phase: force ? "forcing" : "requesting" });
			void getTransport()
				.request("terminal.close", {
					workspaceId: request.tab.workspaceId,
					tabKey: request.tab.tabKey,
					force,
				})
				.then(({ busy }) => {
					if (completed.current.has(request)) return;
					if (busy && force) {
						fail(request, new Error(i18n.t("panels.terminalWorkbench.forceCloseRefused")));
						return;
					}
					if (busy) {
						const terminals =
							useAppStore.getState().terminalsByWorkspace[request.tab.workspaceId] ?? [];
						if (terminals.some((terminal) => terminal.tabKey === request.tab.tabKey)) {
							setCloseState({ request, phase: "confirming" });
						} else {
							finish(request, true);
						}
						return;
					}
					finish(request, true);
				})
				.catch((error) => fail(request, error));
		},
		[fail, finish],
	);
	return {
		requestClose: (tab, onClosed) => close({ tab, onClosed }, false),
		confirmation: (
			<ConfirmDialog
				open={pending !== null}
				onOpenChange={(open) => {
					if (open) return;
					if (pending && forceSubmitted.current === pending) return;
					if (activeRequest.current === pending) activeRequest.current = null;
					setCloseState(null);
				}}
				title={t("panels.terminalWorkbench.busyTitle")}
				description={
					pending
						? t("panels.terminalWorkbench.busyDescription", {
								title: terminalName(t, pending.tab.title),
							})
						: t("panels.terminalWorkbench.busyDescriptionUntitled")
				}
				confirmLabel={t("panels.terminalWorkbench.closeAnyway")}
				confirmTestId="terminal-close-busy-confirm"
				destructive
				onConfirm={() => {
					if (pending) {
						forceSubmitted.current = pending;
						close(pending, true);
					}
				}}
			/>
		),
	};
}
