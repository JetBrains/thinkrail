import type { ToolRenderProps } from "../toolRegistry";
import { resultText, strArg } from "./toolHelpers";

/** Body for the `bash` tool: command on a prompt line + output. The card header/status is shared chrome. */
export function BashCard({ args, result, status }: ToolRenderProps) {
	const command = strArg(args, "command");
	const output = resultText(result);
	const isError = status === "error";

	return (
		<div
			data-testid="tool-bash"
			className="overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-container-header-bg tr-code-text"
		>
			<div className="border-border-default border-b px-sm py-xs">
				<span className="text-feedback-success">$</span>
				<span className="ml-sm text-text-muted">{command}</span>
			</div>
			<pre
				className={`overflow-auto px-sm py-xs tr-code-text leading-relaxed ${isError ? "text-feedback-error" : "text-text-default"}`}
			>
				{output || (status === "running" ? "Running…" : "(no output)")}
			</pre>
		</div>
	);
}
