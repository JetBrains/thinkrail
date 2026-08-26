import { InstallPicker } from "./InstallPicker";

function StepCard({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="rounded-md border border-border bg-container-workspace-bg p-4">
			<div className="flex items-baseline gap-3">
				<h3 className="text-sm font-semibold">{title}</h3>
			</div>
			{description ? (
				<p className="mt-1.5 text-xs leading-relaxed text-text-muted">{description}</p>
			) : null}
			{children ? <div className="mt-3">{children}</div> : null}
		</div>
	);
}

export function HeroQuickStart() {
	return (
		<div className="flex flex-col gap-3">
			<p className="label-mono">Quick start</p>

			<StepCard title="Run ThinkRail in your terminal">
				<InstallPicker />
			</StepCard>

			<StepCard title="Open your project">
				<pre className="overflow-x-auto rounded-md border border-border bg-container-workspace-bg px-4 py-2.5">
					<code className="font-mono text-xs whitespace-nowrap text-primary">
						thinkrail ~/code/my-repo
					</code>
				</pre>
			</StepCard>

			<StepCard
				title="Start working"
				description="Create isolated Git worktrees and start agent sessions."
			/>
		</div>
	);
}
