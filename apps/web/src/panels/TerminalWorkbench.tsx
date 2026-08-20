import type { TerminalTabsPush } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { Plus } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { TerminalTab } from "../store";
import { isConnectedGeneration, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";

const TerminalInstance = lazy(() => import("./TerminalInstance"));

export function useTerminalCatalog(workspaceId: string | null): boolean {
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const status = useAppStore((state) => state.status);
	const [ready, setReady] = useState(false);
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
		setReady(false);
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
					setReady(true);
					return;
				}
				state.setWorkspaceTerminals(workspaceId, tabs);
				setReady(true);
				const installed = useAppStore.getState();
				if ((installed.terminalsByWorkspace[workspaceId]?.length ?? 0) === 0) {
					installed.addTerminal(workspaceId);
				}
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [connectionGeneration, status, workspaceId]);
	return ready;
}

export function TerminalWorkbenchBody({ tab, onAdd }: { tab: TerminalTab; onAdd: () => void }) {
	return (
		<div data-testid="terminal-panel" className="relative h-full min-h-0 bg-container-terminal-bg">
			<button
				type="button"
				data-testid="terminal-add"
				aria-label="New terminal"
				title="New terminal"
				onClick={onAdd}
				className="absolute top-1 right-1 z-10 flex size-5 items-center justify-center rounded-[var(--radius-sm)] bg-container-elevated-bg text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<Plus className="size-4" />
			</button>
			<Suspense fallback={null}>
				<TerminalInstance
					tabKey={tab.tabKey}
					workspaceId={tab.workspaceId}
					{...(tab.initialCommand ? { initialCommand: tab.initialCommand } : {})}
				/>
			</Suspense>
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
			toast.error(errorText(error), "Couldn't close the terminal");
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
						fail(request, new Error("The terminal refused the forced close"));
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
				title="Something is running"
				description={`“${pending?.tab.title ?? "This terminal"}” has a running process. Closing the tab ends it.`}
				confirmLabel="Close anyway"
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
