import { CodeBlock } from "@/chat/tools/CodeBlock";
import { Collapsible, countLines } from "@/chat/tools/Collapsible";

const lines = (count: number) =>
	Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");
const short = lines(24);
const long = lines(25);

export default function Threshold() {
	return (
		<div className="grid w-full grid-cols-2 items-start gap-16">
			<Collapsible id="library-threshold-24:content" lines={countLines(short)}>
				<CodeBlock code={short} lang="text" />
			</Collapsible>
			<Collapsible id="library-threshold-25:content" lines={countLines(long)}>
				<CodeBlock code={long} lang="text" />
			</Collapsible>
		</div>
	);
}
