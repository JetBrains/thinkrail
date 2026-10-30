import { QuietScrollArea } from "@/components/QuietScrollArea";

const LINES = Array.from(
	{ length: 20 },
	(_, index) =>
		`${String(index + 1).padStart(2, " ")}  export const step${index + 1} = createStep({ id: "step-${index + 1}", retries: 3, timeoutMs: 30_000, onFailure: "pause" });`,
);

export default function BothAxes() {
	return (
		<div className="h-160 w-full max-w-[24rem] bg-container-sidebar-bg">
			<QuietScrollArea axis="both" className="h-full" viewportClassName="p-panel-inset">
				<pre className="w-max tr-code-text text-text-default">{LINES.join("\n")}</pre>
			</QuietScrollArea>
		</div>
	);
}
