import { RunningIcon } from "@/components/RunningIcon";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const SIZES = {
	"size-14": "Rows and menus: ProjectTree, the session switcher, the *Switch to* menu.",
	"size-16": "The chat stream footer, beside the phase label.",
	"size-64": "Not a production size — a large specimen to read the draw-and-erase cycle.",
} as const;

const COLOURS = {
	"text-primary": "The active or highlighted row, and the chat footer.",
	"text-text-muted": "An inactive row; a Command row switches to primary while highlighted.",
} as const;

type Size = keyof typeof SIZES;
type Colour = keyof typeof COLOURS;

const CLASSES: Record<Size, Record<Colour, string>> = {
	"size-14": {
		"text-primary": "size-14 text-primary",
		"text-text-muted": "size-14 text-text-muted",
	},
	"size-16": {
		"text-primary": "size-16 text-primary",
		"text-text-muted": "size-16 text-text-muted",
	},
	"size-64": {
		"text-primary": "size-64 text-primary",
		"text-text-muted": "size-64 text-text-muted",
	},
};

const keys = <K extends string>(record: Readonly<Record<K, string>>) => Object.keys(record) as K[];

const code = (name: string) => (
	<code key="name" className="tr-code-text">
		{name}
	</code>
);

function SizesAndColours() {
	return (
		<>
			<Table
				head={["Size", ...keys(COLOURS), "Use it for"]}
				rows={keys(SIZES).map((size) => [
					code(size),
					...keys(COLOURS).map((colour) => (
						<RunningIcon key={colour} className={CLASSES[size][colour]} />
					)),
					<InlineMarkdown key="text" source={SIZES[size]} />,
				])}
			/>
			<Table
				head={["Colour", "Use it for"]}
				rows={keys(COLOURS).map((colour) => [
					code(colour),
					<InlineMarkdown key="text" source={COLOURS[colour]} />,
				])}
			/>
		</>
	);
}

const className = (values: PlaygroundValues) =>
	CLASSES[values.size as Size][values.colour as Colour];

export const runningIconShowcase: Showcase = {
	sections: [
		{
			id: "sizes",
			title: "Sizes and colours",
			description:
				"Every cell is the real badge. It takes its size from `size-*` and its colour from `text-*` through `currentColor`; with reduced motion enabled in the OS every cell shows the static, complete mark.",
			Render: SizesAndColours,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "size", options: keys(SIZES) },
			{ kind: "choice", name: "colour", options: keys(COLOURS) },
		],
		initial: { size: "size-16", colour: "text-primary" },
		Preview: ({ values }) => <RunningIcon className={className(values)} />,
		code: (values) => `<RunningIcon className="${className(values)}" />`,
	},
};
