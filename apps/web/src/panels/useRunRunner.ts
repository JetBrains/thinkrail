import type { RunExecution, RunTarget } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { useEffect, useRef } from "react";
import { latestExecution, selectWorkspaceChatTab, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { promptWorkspaceChat } from "./openChat";
import { browserUrl, executionLabel, type RunAction } from "./runActions";
import { fixRunPrompt, SETUP_RUN_PROMPT } from "./runPrompts";

export interface RunRunner {
	run: (action: RunAction) => void;
	openUrl: (url: string) => boolean;
}

function transportHostname(): string {
	try {
		return new URL(getTransport().httpBase()).hostname;
	} catch {
		return "localhost";
	}
}

function openExternal(url: string): boolean {
	const opened = window.open(browserUrl(url, transportHostname()), "_blank", "noopener,noreferrer");
	return opened !== null;
}

/**
 * Executes Run actions for one workspace. Auto-open fires once per execution, only in the client that
 * started it (a popup blocker leaves a toast with the link instead).
 */
export function useRunRunner(workspaceId: string | null, projectId: string | null): RunRunner {
	const t = useT();
	const pushToast = useAppStore((state) => state.pushToast);
	const sessionId = useAppStore((state) =>
		workspaceId ? (selectWorkspaceChatTab(state, workspaceId)?.sessionId ?? null) : null,
	);
	const state = useAppStore((s) => (workspaceId ? s.runByWorkspace[workspaceId] : undefined));
	const run = useAppStore((s) => (projectId ? s.runByProject[projectId] : undefined));
	const initiated = useRef(new Set<string>());
	const autoOpened = useRef(new Set<string>());

	const recipe = run?.document?.recipe ?? null;
	const autoOpen = run?.settings.autoOpen ?? false;
	const latest = latestExecution(state);
	useEffect(() => {
		if (!autoOpen || !latest || latest.status !== "listening" || !latest.url) return;
		if (!initiated.current.has(latest.runId) || autoOpened.current.has(latest.runId)) return;
		autoOpened.current.add(latest.runId);
		const url = latest.url;
		if (!openExternal(url)) {
			pushToast({
				variant: "info",
				title: t("panels.run.autoOpenBlocked.title", {
					target: executionLabel(t, latest, recipe),
				}),
				message: t("panels.run.autoOpenBlocked.message"),
				action: { label: t("panels.run.open"), onClick: () => void openExternal(url) },
			});
		}
	}, [autoOpen, latest, pushToast, recipe, t]);

	const fail = (title: string) => (error: unknown) =>
		pushToast({ variant: "error", title, message: errorText(error) });

	const remember = (execution: RunExecution): void => {
		initiated.current.add(execution.runId);
	};

	const targetLabel = (targetId: string | null): string | null => {
		if (targetId === null) return t("panels.run.prepareTarget");
		const target: RunTarget | undefined = recipe?.targets.find((entry) => entry.id === targetId);
		return target ? (target.title ?? target.id) : targetId;
	};

	const ask = (text: string): void => {
		if (!workspaceId) return;
		void promptWorkspaceChat(workspaceId, sessionId, text).catch(fail(t("panels.run.askFailed")));
	};

	return {
		openUrl: openExternal,
		run: (action) => {
			if (!workspaceId) return;
			switch (action.kind) {
				case "setUp":
					ask(SETUP_RUN_PROMPT);
					return;
				case "fix":
					ask(fixRunPrompt(action.execution, targetLabel(action.execution?.targetId ?? null)));
					return;
				case "start":
					void getTransport()
						.request("run.start", {
							workspaceId,
							targetId: action.targetId,
							...(action.prepare ? {} : { prepare: false }),
						})
						.then(({ execution }) => {
							remember(execution);
							useAppStore
								.getState()
								.revealTerminalTab(workspaceId, execution.tabKey, tabTitle(action.targetId));
						})
						.catch(fail(t("panels.run.failed.start")));
					return;
				case "restart":
					void getTransport()
						.request("run.restart", { workspaceId, targetId: action.targetId })
						.then(({ execution }) => {
							remember(execution);
							useAppStore
								.getState()
								.revealTerminalTab(workspaceId, execution.tabKey, tabTitle(action.targetId));
						})
						.catch(fail(t("panels.run.failed.start")));
					return;
				case "stop":
					void getTransport()
						.request("run.stop", { workspaceId, targetId: action.targetId })
						.catch(fail(t("panels.run.failed.stop")));
					return;
				case "open":
					openExternal(action.url);
					return;
				case "showTerminal": {
					const execution = state?.executions.find((entry) => entry.tabKey === action.tabKey);
					useAppStore
						.getState()
						.revealTerminalTab(workspaceId, action.tabKey, tabTitle(execution?.targetId ?? null));
					return;
				}
				case "openTab":
					useAppStore.getState().requestToolView(workspaceId, "run");
					return;
			}
		},
	};

	function tabTitle(targetId: string | null): string {
		return targetLabel(targetId) ?? t("panels.run.caption");
	}
}
