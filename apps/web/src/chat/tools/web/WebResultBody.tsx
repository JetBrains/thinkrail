import { Markdown } from "../../Markdown";
import type { ToolStatus } from "../../types";
import { Collapsible, countLines } from "../Collapsible";

export function WebResultBody({
	id,
	output,
	status,
	runningLabel,
	emptyLabel,
}: {
	id: string;
	output: string;
	status: ToolStatus;
	runningLabel: string;
	emptyLabel: string;
}) {
	if (status === "running") {
		return <span className="text-text-muted tr-text-metadata">{runningLabel}</span>;
	}
	if (status === "error") {
		return <pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{output}</pre>;
	}
	if (!output) {
		return <span className="text-text-muted tr-text-metadata italic">{emptyLabel}</span>;
	}
	return (
		<Collapsible id={id} lines={countLines(output)}>
			<Markdown text={output} />
		</Collapsible>
	);
}
