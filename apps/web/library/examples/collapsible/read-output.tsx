import { CodeBlock } from "@/chat/tools/CodeBlock";
import { Collapsible, countLines } from "@/chat/tools/Collapsible";

const toolCallId = "library-read-output";
const output = `${Array.from(
	{ length: 16 },
	(_, i) => `export function handler${i + 1}(input: string) {\n\treturn input.trim();\n}`,
).join("\n")}\n`;

export default function ReadOutput() {
	return (
		<div className="w-full">
			<Collapsible id={`${toolCallId}:content`} lines={countLines(output)}>
				<CodeBlock code={output} lang="ts" />
			</Collapsible>
		</div>
	);
}
