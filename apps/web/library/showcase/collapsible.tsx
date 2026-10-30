import { Markdown } from "@/chat/Markdown";
import { CodeBlock } from "@/chat/tools/CodeBlock";
import { Collapsible, countLines } from "@/chat/tools/Collapsible";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const ELEVATED_FADE = "bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)]";
const LINE_OPTIONS = ["12", "24", "25", "60"] as const;

const codeLines = (count: number) =>
	Array.from({ length: count }, (_, i) => `const value${i + 1} = ${i + 1};`).join("\n");
const markdownLines = (count: number) =>
	Array.from({ length: count }, (_, i) => `- Item ${i + 1}`).join("\n");

const ROWS = [
	{
		state: "Short",
		how: "`lines={6}` — 24 lines or fewer render as they are.",
		id: "library-states-short",
		count: 6,
	},
	{
		state: "Collapsed → expanded",
		how: "`lines={60}` — capped behind the fade. Click the toggle to expand, click again to collapse.",
		id: "library-states-long",
		count: 60,
	},
] as const;

function States() {
	return (
		<Table
			head={["State", "How", "Live"]}
			rows={ROWS.map((row) => {
				const code = codeLines(row.count);
				return [
					<span key="state" className="tr-text-emphasis">
						{row.state}
					</span>,
					<InlineMarkdown key="how" source={row.how} />,
					<div key="live" className="w-full min-w-[16rem]">
						<Collapsible id={`${row.id}:content`} lines={countLines(code)}>
							<CodeBlock code={code} lang="ts" />
						</Collapsible>
					</div>,
				];
			})}
		/>
	);
}

function Preview({ values }: { values: PlaygroundValues }) {
	const count = Number(values.lines);
	const markdown = values.content === "markdown";
	const text = markdown ? markdownLines(count) : codeLines(count);
	const fadeClass = values.fade === "elevated" ? ELEVATED_FADE : undefined;
	return (
		<div className="w-full self-start">
			<Collapsible
				id="library-collapsible-playground:content"
				lines={countLines(text)}
				{...(fadeClass ? { fadeClass } : {})}
			>
				{markdown ? <Markdown text={text} /> : <CodeBlock code={text} lang="ts" />}
			</Collapsible>
		</div>
	);
}

function code(values: PlaygroundValues) {
	const markdown = values.content === "markdown";
	const fade = values.fade === "elevated" ? `\n\tfadeClass="${ELEVATED_FADE}"` : "";
	const child = markdown ? "<Markdown text={output} />" : '<CodeBlock code={output} lang="ts" />';
	return `// output has ${values.lines} lines
<Collapsible
	id={\`\${toolCallId}:content\`}
	lines={countLines(output)}${fade}
>
	${child}
</Collapsible>`;
}

export const collapsibleShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. The fold starts collapsed; the toggle is the only way to expand it, and the choice is remembered per `id`.",
			Render: States,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "lines", options: LINE_OPTIONS },
			{ kind: "choice", name: "content", options: ["code", "markdown"] },
			{ kind: "choice", name: "fade", options: ["default", "elevated"] },
		],
		initial: { lines: "60", content: "code", fade: "default" },
		Preview,
		code,
	},
};
