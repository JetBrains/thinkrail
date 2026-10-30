import { AttentionLine } from "@thinkrail/ui/attention-line";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const CASES = [
	{ props: "default", announced: false, live: true },
	{ props: "announced", announced: true, live: true },
	{ props: "live={false}", announced: false, live: false },
] as const;

function States() {
	return (
		<Table
			head={["Props", "Live"]}
			rows={CASES.map((item) => [
				<code key="props" className="tr-code-text">
					{item.props}
				</code>,
				<AttentionLine key="live" announced={item.announced} live={item.live} />,
			])}
		/>
	);
}

function config(values: PlaygroundValues) {
	return { announced: values.announced === true, live: values.live === true };
}

export const attentionLineShowcase: Showcase = {
	sections: [{ id: "states", Render: States }],
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
