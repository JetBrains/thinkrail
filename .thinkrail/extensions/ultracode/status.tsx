import { openSurface } from "@thinkrail/ext/view";
import { useRuns } from "./hooks";
import { EXT_NAME, formatCost } from "./model";
import { WorkflowIcon } from "./parts";

const Status = () => {
	const running = useRuns()?.filter((run) => run.status === "running") ?? [];
	const [only] = running;
	if (!only) return null;
	const total = running.reduce((sum, run) => sum + run.counts.total, 0);
	const settled = running.reduce(
		(sum, run) => sum + run.counts.done + run.counts.failed + run.counts.aborted,
		0,
	);
	const cost = running.reduce((sum, run) => sum + run.cost, 0);
	return (
		<button
			type="button"
			data-testid="ultracode-status"
			title={running.length === 1 ? `Workflow ${only.name}` : `${running.length} workflows running`}
			onClick={() =>
				running.length === 1
					? openSurface(EXT_NAME, "run", { runId: only.runId })
					: openSurface(EXT_NAME, "workflows")
			}
			className="flex items-center gap-4 rounded-sm px-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
		>
			<WorkflowIcon className="size-14 animate-pulse text-primary" />
			<span className="tabular-nums">
				wf{running.length > 1 ? ` ×${running.length}` : ""}: {settled}/{total} agents ·{" "}
				{formatCost(cost)}
			</span>
		</button>
	);
};

export default Status;
