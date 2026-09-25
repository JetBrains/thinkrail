import { openSurface, remixicon, type SurfaceProps } from "@thinkrail/ext/view";
import { usePulse } from "./hooks";
import { headLabel } from "./model";

const { RiGitBranchLine, RiErrorWarningLine } = remixicon;

const ITEM =
	"flex max-w-xs items-center gap-4 rounded-sm px-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default";

const open = () => openSurface("git-pulse", "dashboard");

const Badge = ({ host }: SurfaceProps) => {
	const pulse = usePulse(host.workspaceId);
	if (!pulse || pulse.state === "loading" || pulse.state === "not-git") return null;
	if (pulse.state === "error")
		return (
			<button
				type="button"
				data-testid="git-pulse-status"
				data-state="error"
				title={pulse.message}
				onClick={open}
				className={ITEM}
			>
				<RiErrorWarningLine className="size-14 text-feedback-error" />
				<span>git</span>
			</button>
		);
	const { upstream } = pulse;
	const changed = pulse.filesTotal > 0 ? `${pulse.filesTotal} changed` : "clean";
	return (
		<button
			type="button"
			data-testid="git-pulse-status"
			data-state="ready"
			title="Open Git pulse"
			onClick={open}
			className={ITEM}
		>
			<RiGitBranchLine className="size-14 shrink-0" />
			<span className="truncate">{headLabel(pulse.head)}</span>
			{upstream && !upstream.gone && (
				<span className="shrink-0 tabular-nums">
					↑{upstream.ahead} ↓{upstream.behind}
				</span>
			)}
			<span className="shrink-0 text-text-subtle">·</span>
			<span className="shrink-0 tabular-nums">{changed}</span>
		</button>
	);
};

export default Badge;
