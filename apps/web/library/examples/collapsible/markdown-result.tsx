import { Markdown } from "@/chat/Markdown";
import { Collapsible, countLines } from "@/chat/tools/Collapsible";

const output = [
	"Found 14 pages for the query:",
	"",
	...Array.from(
		{ length: 14 },
		(_, i) =>
			`${i + 1}. **Result ${i + 1}** — example.com/docs/page-${i + 1}\n   A short summary of what this page says about the query.`,
	),
].join("\n");

export default function MarkdownResult() {
	return (
		<div className="w-full">
			<Collapsible id="library-web-result:content" lines={countLines(output)}>
				<Markdown text={output} />
			</Collapsible>
		</div>
	);
}
