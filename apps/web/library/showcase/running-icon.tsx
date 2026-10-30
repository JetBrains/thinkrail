import { RunningIcon } from "@/components/RunningIcon";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const SIZES = ["size-14", "size-16", "size-64"] as const;
const COLOURS = ["text-primary", "text-text-muted"] as const;

type Size = (typeof SIZES)[number];
type Colour = (typeof COLOURS)[number];

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

const code = (name: string) => (
	<code key="name" className="tr-code-text">
		{name}
	</code>
);

function SizesAndColours() {
	return (
		<Table
			head={["Size", ...COLOURS]}
			rows={SIZES.map((size) => [
				code(size),
				...COLOURS.map((colour) => <RunningIcon key={colour} className={CLASSES[size][colour]} />),
			])}
		/>
	);
}

const className = (values: PlaygroundValues) =>
	CLASSES[values.size as Size][values.colour as Colour];

export const runningIconShowcase: Showcase = {
	sections: [{ id: "sizes", Render: SizesAndColours }],
	playground: {
		controls: [
			{ kind: "choice", name: "size", options: SIZES },
			{ kind: "choice", name: "colour", options: COLOURS },
		],
		initial: { size: "size-16", colour: "text-primary" },
		Preview: ({ values }) => <RunningIcon className={className(values)} />,
		code: (values) => `<RunningIcon className="${className(values)}" />`,
	},
};
