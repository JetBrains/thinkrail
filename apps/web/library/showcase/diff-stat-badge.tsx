import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const CASES = [
	{ name: "Added and removed", added: 12, removed: 4 },
	{ name: "Added only", added: 34, removed: 0 },
	{ name: "Removed only", added: 0, removed: 7 },
	{ name: "Large counts", added: 12045, removed: 3871 },
	{ name: "Empty", added: 0, removed: 0 },
] as const;

const COUNTS = ["0", "1", "42", "1204", "12045"] as const;

function StateMatrix() {
	return (
		<Table
			head={["Case", "Props", "Rendered"]}
			rows={CASES.map(({ name, added, removed }) => [
				<span key="case" className="tr-text-emphasis">
					{name}
				</span>,
				<code key="props" className="tr-code-text text-text-muted">
					{`added={${added}} removed={${removed}}`}
				</code>,
				<span key="live" className="flex items-center gap-8">
					<DiffStatBadge added={added} removed={removed} />
					{added > 0 || removed > 0 ? null : (
						<span className="tr-text-metadata text-text-muted">renders nothing</span>
					)}
				</span>,
			])}
		/>
	);
}

const count = (values: PlaygroundValues, name: string) => Number(values[name] ?? 0);

export const diffStatBadgeShowcase: Showcase = {
	sections: [{ id: "states", Render: StateMatrix }],
	playground: {
		controls: [
			{ kind: "choice", name: "added", options: COUNTS },
			{ kind: "choice", name: "removed", options: COUNTS },
		],
		initial: { added: "42", removed: "1" },
		Preview: ({ values }) => (
			<span className="flex items-center gap-8">
				<DiffStatBadge added={count(values, "added")} removed={count(values, "removed")} />
				{count(values, "added") > 0 || count(values, "removed") > 0 ? null : (
					<span className="tr-text-metadata text-text-muted">renders nothing</span>
				)}
			</span>
		),
		code: (values) =>
			`<DiffStatBadge added={${count(values, "added")}} removed={${count(values, "removed")}} />`,
	},
};
