import { cn } from "@thinkrail/ui/utils";
import type { PlainRun, PlainRunKind } from "./plainRuns";

const MARKER: Record<PlainRunKind, string> = {
	hunk: "",
	context: " ",
	deletion: "-",
	addition: "+",
};

export function PlainCode({ runs, diff = false }: { runs: readonly PlainRun[]; diff?: boolean }) {
	return (
		<pre
			data-testid="plain-code"
			className="m-0 min-w-0 overflow-x-auto px-12 py-4 tr-code-editor text-text-default"
		>
			{runs.map((run) => (
				<div
					key={run.key}
					data-kind={run.kind}
					className={cn("flex", run.kind === "hunk" && "text-text-muted")}
				>
					{diff ? (
						<span className="select-none pr-8">
							{run.lines.map(() => MARKER[run.kind]).join("\n")}
						</span>
					) : null}
					<span>{run.lines.map((line) => line || " ").join("\n")}</span>
				</div>
			))}
		</pre>
	);
}
