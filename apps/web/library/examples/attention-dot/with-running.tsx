import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";

export default function WithRunning() {
	return (
		<div className="flex w-full max-w-xs min-w-0 items-center gap-8">
			<button type="button" className="flex min-w-0 flex-1 items-center gap-4 text-left">
				<RunningIcon className="size-14 text-text-muted" />
				<span className="truncate tr-text-ui text-text-muted">fix-login</span>
			</button>
			<AttentionDot />
		</div>
	);
}
