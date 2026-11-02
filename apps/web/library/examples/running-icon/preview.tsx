import { RunningIcon } from "@/components/RunningIcon";

export default function Preview() {
	return (
		<div className="flex items-center gap-16">
			<RunningIcon className="size-14 text-primary" />
			<RunningIcon className="size-14 text-text-muted" />
			<RunningIcon className="size-16 text-primary" />
		</div>
	);
}
