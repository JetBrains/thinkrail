import type { HookName, HookSource } from "@thinkrail/contracts";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { aggregateHookState, toast, useAppStore } from "../store";
import { errorText } from "../transport";
import { HookApprovalDialog } from "./HookApprovalDialog";
import { HookStatusIcon } from "./HookStatusIcon";
import { runHookNow } from "./hooksActions";

const HOOK_LABEL: Record<HookName, string> = {
	onCreate: "onCreate",
	onDelete: "onDelete",
	preMerge: "preMerge",
	postMerge: "postMerge",
};

const SOURCE_LABEL: Record<HookSource, string> = {
	shared: "Shared",
	local: "Local",
};

/** Shared always before Local — the fixed run order `combineMode: "both"` uses. */
const SOURCE_ORDER: readonly HookSource[] = ["shared", "local"];

/**
 * Hooks for the active worktree: one row per declared lifecycle hook that has ever reported a status
 * (`Workspace.hookStatus`), each with its live output when present (`hookOutputByWorkspace`). A hook's
 * header shows the worst-of-both-tiers state (`aggregateHookState`); beneath it, one row per SOURCE
 * (Shared/Local) that has actually reported a status shows that source's own state + command — a
 * `combineMode` of `"both"` can have Shared and Local sitting at different states at once. `preMerge`/
 * `postMerge` never show up here in practice — nothing calls them yet — but the panel doesn't special-case
 * that away; an empty list is just an empty list.
 */
export function HooksPanel({ workspaceId }: { workspaceId: string }) {
	const workspace = useAppStore((s) =>
		Object.values(s.workspaces)
			.flat()
			.find((w) => w.id === workspaceId),
	);
	const output = useAppStore((s) => s.hookOutputByWorkspace[workspaceId]);
	const [approving, setApproving] = useState<{ hook: HookName; command: string } | null>(null);

	if (!workspace) return <p className="px-sm py-xs text-xs text-hint">Loading…</p>;

	const hooks = (Object.keys(workspace.hookStatus ?? {}) as HookName[]).sort((a, b) =>
		a.localeCompare(b),
	);

	if (hooks.length === 0) {
		return (
			<p data-testid="hooks-empty" className="px-sm py-xs text-xs text-hint">
				No hooks declared for this workspace.
			</p>
		);
	}

	const runNow = (hook: HookName) => {
		void runHookNow(workspaceId, hook).catch((err) =>
			toast.error(errorText(err, `Failed to run ${hook}`)),
		);
	};

	return (
		<div className="flex h-full min-h-0 flex-col overflow-auto">
			<ul className="flex flex-col divide-y divide-border2">
				{hooks.map((hook) => {
					const bySource = workspace.hookStatus?.[hook] ?? {};
					const state = aggregateHookState(bySource);
					if (!state) return null;
					const sources = SOURCE_ORDER.filter((source) => bySource[source]);

					return (
						<li key={hook} data-testid="hook-row" data-hook={hook} data-status={state}>
							<div className="flex items-center gap-sm px-sm py-xs text-sm">
								<HookStatusIcon state={state} />
								<span className="font-medium text-text">{HOOK_LABEL[hook]}</span>
								<span className="flex-1" />
								{state === "awaitingApproval" && (
									<button
										type="button"
										data-testid="hook-approve"
										onClick={() => {
											const command = sources
												.map((source) => bySource[source])
												.find((s) => s?.state === "awaitingApproval")?.command;
											if (command) setApproving({ hook, command });
										}}
										className="rounded-[var(--radius-sm)] bg-primary px-sm py-0.5 text-primary-fg text-xs hover:opacity-90"
									>
										Approve & Run
									</button>
								)}
								{state === "failed" && (
									<button
										type="button"
										data-testid="hook-retry"
										aria-label={`Retry ${hook}`}
										onClick={() => runNow(hook)}
										className="flex items-center gap-xs rounded-[var(--radius-sm)] px-sm py-0.5 text-hint text-xs hover:bg-hover hover:text-text"
									>
										<RotateCcw className="size-3" /> Retry
									</button>
								)}
							</div>
							<ul className="flex flex-col gap-xs pb-xs pl-lg">
								{sources.map((source) => {
									const status = bySource[source];
									if (!status) return null;
									return (
										<li
											key={source}
											data-testid={`hook-command-${source}`}
											data-source={source}
											data-status={status.state}
											className="flex flex-col gap-0.5"
										>
											<div className="flex items-center gap-sm text-xs">
												<HookStatusIcon state={status.state} />
												<span className="text-hint">{SOURCE_LABEL[source]}</span>
												{status.state === "failed" && (
													<span className="text-hint">exit {status.exitCode}</span>
												)}
											</div>
											{status.command && (
												<code
													data-testid="hook-command"
													className="block whitespace-pre-wrap pl-lg font-[var(--font-mono)] text-hint text-xs"
												>
													{status.command}
												</code>
											)}
										</li>
									);
								})}
							</ul>
							{output?.[hook]?.output ? (
								<pre
									data-testid="hook-output"
									className="max-h-40 overflow-auto whitespace-pre-wrap bg-elevated px-sm py-xs font-[var(--font-mono)] text-hint text-xs"
								>
									{output[hook]?.output}
								</pre>
							) : null}
						</li>
					);
				})}
			</ul>

			{approving && (
				<HookApprovalDialog
					open
					onOpenChange={(o) => {
						if (!o) setApproving(null);
					}}
					projectId={workspace.projectId}
					workspaceId={workspaceId}
					hook={approving.hook}
					command={approving.command}
				/>
			)}
		</div>
	);
}
