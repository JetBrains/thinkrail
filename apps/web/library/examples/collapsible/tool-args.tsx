import { ToolArgList, toolArgEntries } from "@/chat/ToolArgList";
import { Collapsible, countLines } from "@/chat/tools/Collapsible";

const args = {
	repository: "thinkrail/thinkrail",
	query: "is:open label:bug",
	fields: ["title", "author", "labels", "assignees", "milestone", "createdAt", "updatedAt"],
	filters: { state: "open", sort: "updated", direction: "desc", perPage: 50, page: 1 },
};

export default function ToolArgs() {
	const entries = toolArgEntries(args);
	const lines = entries.reduce((total, entry) => total + Math.max(1, countLines(entry.value)), 0);
	return (
		<div className="w-full">
			<Collapsible id="library-mcp-call:args" lines={lines}>
				<ToolArgList entries={entries} />
			</Collapsible>
		</div>
	);
}
