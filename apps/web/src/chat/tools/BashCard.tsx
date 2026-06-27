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
			className="overflow-hidden rounded-[var(--radius-sm)] border border-border2 bg-bg-dark font-[var(--font-mono)]"
		>
			<div className="border-border2 border-b px-sm py-xs">
				<span className="text-green">$</span>
				<span className="ml-sm text-muted text-xs">{command}</span>
			</div>
			<pre
				className={`overflow-auto px-sm py-xs text-xs leading-relaxed ${isError ? "text-red" : "text-text"}`}
			>
				{output || (status === "running" ? "Running…" : "(no output)")}
			</pre>
		</div>
	);
}
