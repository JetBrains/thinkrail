import { RunningIcon } from "@/components/RunningIcon";

export default function TwoLineRow() {
	return (
		<button type="button" className="flex w-full max-w-xs min-w-0 items-start gap-4 text-left">
			<RunningIcon className="mt-2 size-14 text-primary" />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate tr-text-ui leading-tight text-primary">Login fix</span>
				<span className="truncate text-text-subtle tr-text-metadata leading-tight">
					julia/fix-login-redirect
				</span>
			</span>
		</button>
	);
}
