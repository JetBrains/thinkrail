import type { ToolRenderProps } from "../toolRegistry";
import { resultText, strArg } from "./toolHelpers";

export function BashCard({ args, result, status }: ToolRenderProps) {
	const command = strArg(args, "command");
	const output = resultText(result);
	const isError = status === "error";

	return (
		<div
			data-testid="tool-bash"
			className="overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-container-header-bg tr-code-text"
		>
			<div className="border-border-default border-b px-8 py-4">
				<span className="text-feedback-success">$</span>
				<span className="ml-8 text-text-muted">{command}</span>
			</div>
			<pre
				className={`overflow-auto px-8 py-4 tr-code-text leading-relaxed ${isError ? "text-feedback-error" : "text-text-default"}`}
			>
				{output || (status === "running" ? "Running…" : "(no output)")}
			</pre>
		</div>
	);
}
