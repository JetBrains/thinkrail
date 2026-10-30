import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";

export default function WithAttention() {
	return (
		<div className="flex w-full max-w-xs min-w-0 items-center gap-8">
			<button type="button" className="flex min-w-0 flex-1 items-center gap-4 text-left">
				<RunningIcon className="size-14 text-primary" />
				<span className="truncate tr-text-ui text-primary">fix-login</span>
			</button>
			<AttentionDot />
		</div>
	);
}
