import {
	openSurface,
	remixicon,
	type SessionStats,
	type SurfaceProps,
	useChannel,
} from "@thinkrail/ext/view";
import { useWatch } from "./hooks";
import { formatCost } from "./layout";
import { runningTools, type Timeline } from "./model";

const { RiBarChartHorizontalLine } = remixicon;

const CostStatus = ({ host }: SurfaceProps) => {
	const { sessionId } = host;
	useWatch(sessionId);
	const stats = useChannel<SessionStats>(sessionId ? `cost:${sessionId}` : "");
	const timeline = useChannel<Timeline>(sessionId ?? "");
	if (!sessionId || !stats) return null;
	const percent = stats.contextUsage?.percent;
	const running = runningTools(timeline);
	const parts = [
		formatCost(stats.cost),
		...(percent != null ? [`${Math.round(percent)}% ctx`] : []),
		...(running > 0 ? [`${running} running`] : []),
	];
	return (
		<button
			type="button"
			data-testid="timeline-status"
			title="Open the timeline"
			onClick={() => openSurface("timeline", "timeline")}
			className="flex items-center gap-4 rounded-sm px-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
		>
			<RiBarChartHorizontalLine className={running > 0 ? "size-14 text-primary" : "size-14"} />
			<span className="truncate tabular-nums">{parts.join(" · ")}</span>
		</button>
	);
};

export default CostStatus;
