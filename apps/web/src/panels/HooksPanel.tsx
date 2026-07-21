import type { HookName, HookStatus } from "@thinkrail/contracts";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast, useAppStore } from "../store";
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

/**
 * Hooks for the active worktree: one row per declared lifecycle hook that has ever reported a status
 * (`Workspace.hookStatus`), each with its live output when present (`hookOutputByWorkspace`). `preMerge`/
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

	const entries = (Object.entries(workspace.hookStatus ?? {}) as [HookName, HookStatus][]).sort(
		([a], [b]) => a.localeCompare(b),
	);

	if (entries.length === 0) {
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
				{entries.map(([hook, status]) => (
					<li key={hook} data-testid="hook-row" data-hook={hook} data-status={status.state}>
						<div className="flex items-center gap-sm px-sm py-xs text-sm">
							<HookStatusIcon state={status.state} />
							<span className="font-medium text-text">{HOOK_LABEL[hook]}</span>
							{status.state === "failed" && (
								<span className="text-hint text-xs">exit {status.exitCode}</span>
							)}
							<span className="flex-1" />
							{status.state === "awaitingApproval" && (
								<button
									type="button"
									data-testid="hook-approve"
									onClick={() => status.command && setApproving({ hook, command: status.command })}
									className="rounded-[var(--radius-sm)] bg-primary px-sm py-0.5 text-primary-fg text-xs hover:opacity-90"
								>
									Approve & Run
								</button>
							)}
							{status.state === "failed" && (
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
						{status.command && (
							<code
								data-testid="hook-command"
								className="block truncate px-sm pb-xs font-[var(--font-mono)] text-hint text-xs"
							>
								{status.command}
							</code>
						)}
						{output?.[hook]?.output ? (
							<pre
								data-testid="hook-output"
								className="max-h-40 overflow-auto whitespace-pre-wrap bg-elevated px-sm py-xs font-[var(--font-mono)] text-hint text-xs"
							>
								{output[hook]?.output}
							</pre>
						) : null}
					</li>
				))}
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
