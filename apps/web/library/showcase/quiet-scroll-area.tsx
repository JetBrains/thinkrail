import { cn } from "@thinkrail/ui/utils";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

type Surface = "sidebar" | "terminal";
type Axis = "vertical" | "both";
type Content = "short" | "long" | "wide";
type Start = "top" | "middle" | "end";

const SURFACE_BG: Record<Surface, string> = {
	sidebar: "bg-container-sidebar-bg",
	terminal: "bg-container-terminal-bg",
};

function lines(content: Content): string {
	const count = content === "short" ? 3 : 30;
	return Array.from({ length: count }, (_, index) =>
		content === "wide"
			? `${index + 1}  export const step${index + 1} = createStep({ id: "step-${index + 1}", retries: 3, onFailure: "pause" });`
			: `src/panels/file-${index + 1}.ts`,
	).join("\n");
}

function scrollTo(start: Start, axis: Axis) {
	return (node: HTMLDivElement | null) => {
		if (!node || start === "top") return;
		const top = start === "end" ? node.scrollHeight : (node.scrollHeight - node.clientHeight) / 2;
		const left =
			axis === "both" && start === "middle" ? (node.scrollWidth - node.clientWidth) / 2 : 0;
		node.scrollTo({ top, left });
	};
}

function Specimen({
	surface = "sidebar",
	axis = "vertical",
	content = "long",
	start = "top",
}: {
	surface?: Surface;
	axis?: Axis;
	content?: Content;
	start?: Start;
}) {
	return (
		<div className={cn("h-120 w-full max-w-[20rem]", SURFACE_BG[surface])}>
			<QuietScrollArea
				surface={surface}
				axis={axis}
				className="h-full"
				viewportClassName="p-panel-inset"
				viewportRef={scrollTo(start, axis)}
			>
				<pre className={cn("tr-code-text text-text-default", content === "wide" && "w-max")}>
					{lines(content)}
				</pre>
			</QuietScrollArea>
		</div>
	);
}

const ROWS: readonly {
	state: string;
	how: string;
	props: Parameters<typeof Specimen>[0];
}[] = [
	{ state: "No overflow", how: "Content fits.", props: { content: "short" } },
	{
		state: "At the start",
		how: "Overflow below.",
		props: { content: "long" },
	},
	{
		state: "In the middle",
		how: "Overflow on both sides.",
		props: { content: "long", start: "middle" },
	},
	{
		state: "At the end",
		how: "Scrolled to the bottom.",
		props: { content: "long", start: "end" },
	},
	{
		state: "Both axes",
		how: '`axis="both"`, scrolled to the middle of wide content.',
		props: { content: "wide", axis: "both", start: "middle" },
	},
	{
		state: "Terminal surface",
		how: '`surface="terminal"` on `container-terminal-bg`.',
		props: { content: "long", surface: "terminal", start: "middle" },
	},
];

function States() {
	return (
		<Table
			head={["Case", "How", "Live"]}
			rows={ROWS.map((row) => [
				<span key="state" className="tr-text-emphasis">
					{row.state}
				</span>,
				<InlineMarkdown key="how" source={row.how} />,
				<div key="live" className="w-full min-w-[16rem]">
					<Specimen {...row.props} />
				</div>,
			])}
		/>
	);
}

function toProps(values: PlaygroundValues) {
	return {
		surface: (values.surface as Surface | undefined) ?? "sidebar",
		axis: (values.axis as Axis | undefined) ?? "vertical",
		content: (values.content as Content | undefined) ?? "long",
	};
}

function code(values: PlaygroundValues) {
	const { surface, axis } = toProps(values);
	const props = [
		surface === "terminal" ? ' surface="terminal"' : "",
		axis === "both" ? ' axis="both"' : "",
	].join("");
	return [
		`<div className="h-120 ${SURFACE_BG[surface]}">`,
		`\t<QuietScrollArea${props} className="h-full" viewportClassName="p-panel-inset">`,
		"\t\t{content}",
		"\t</QuietScrollArea>",
		"</div>",
	].join("\n");
}

export const quietScrollAreaShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. A curtain fades in on each clipped edge; hover a cell or scroll it to reveal the thumb.",
			Render: States,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "surface", options: ["sidebar", "terminal"] },
			{ kind: "choice", name: "axis", options: ["vertical", "both"] },
			{ kind: "choice", name: "content", options: ["short", "long", "wide"] },
		],
		initial: { surface: "sidebar", axis: "vertical", content: "long" },
		Preview: ({ values }) => {
			const props = toProps(values);
			return <Specimen key={`${props.surface}-${props.axis}-${props.content}`} {...props} />;
		},
		code,
	},
};
