import { CodeBlock } from "@/chat/tools/CodeBlock";
import { Collapsible, countLines } from "@/chat/tools/Collapsible";

const output = Array.from({ length: 40 }, (_, i) => `export const step${i + 1} = ${i + 1};`).join(
	"\n",
);

export default function Preview() {
	return (
		<div className="w-full">
			<Collapsible id="library-collapsible-preview:content" lines={countLines(output)}>
				<CodeBlock code={output} lang="ts" />
			</Collapsible>
		</div>
	);
}
