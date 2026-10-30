import { AttentionLine } from "@thinkrail/ui/attention-line";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const CASES: readonly {
	props: string;
	announced: boolean;
	live: boolean;
	region: string;
}[] = [
	{
		props: "default",
		announced: false,
		live: true,
		region: "Mounted, empty",
	},
	{
		props: "announced",
		announced: true,
		live: true,
		region: "“Your input is needed — the agent is waiting.”",
	},
	{
		props: "live={false}",
		announced: false,
		live: false,
		region: "Not rendered — the owner announces",
	},
];

function code(name: string) {
	return (
		<code key={name} className="tr-code-text">
			{name}
		</code>
	);
}

function States() {
	return (
		<Table
			head={["Props", "Live", "Visible line", "Live region"]}
			rows={CASES.map((item) => [
				code(item.props),
				<AttentionLine key="live" announced={item.announced} live={item.live} />,
				item.live && !item.announced ? "Exposed" : code("aria-hidden"),
				item.region,
			])}
		/>
	);
}

function config(values: PlaygroundValues) {
	return { announced: values.announced === true, live: values.live === true };
}

export const attentionLineShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"The three configurations look identical; they differ only in which copy of the message is in the accessibility tree. Every cell is the real component.",
			Render: States,
		},
	],
	playground: {
		controls: [
			{ kind: "flag", name: "announced" },
			{ kind: "flag", name: "live" },
		],
		initial: { announced: false, live: true },
		Preview: ({ values }) => <AttentionLine {...config(values)} />,
		code: (values) => {
			const { announced, live } = config(values);
			const props = [...(announced ? ["announced"] : []), ...(live ? [] : ["live={false}"])];
			return `<AttentionLine${props.map((prop) => ` ${prop}`).join("")} />`;
		},
	},
};
