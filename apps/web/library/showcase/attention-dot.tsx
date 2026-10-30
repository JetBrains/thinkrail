import { RiGitBranchLine } from "@remixicon/react";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { Showcase } from "./types";

const FACTS = [
	{ session: "Quiet, queued, stopped or in the background", running: false, attention: false },
	{ session: "Working", running: true, attention: false },
	{ session: "Waiting for input (`needsInput`)", running: false, attention: true },
	{
		session: "Finished, failed or interrupted, unread (`completionUnread`)",
		running: false,
		attention: true,
	},
	{ session: "Waiting for input while still running", running: true, attention: true },
] as const;

function Row({ running, attention }: { running: boolean; attention: boolean }) {
	return (
		<span className="flex w-full min-w-0 items-center gap-8">
			<span className="flex min-w-0 flex-1 items-center gap-4">
				{running ? (
					<RunningIcon className="size-14 text-text-muted" />
				) : (
					<RiGitBranchLine className="size-14 shrink-0 text-text-muted" />
				)}
				<span className="truncate tr-text-ui text-text-muted">fix-login</span>
			</span>
			{attention ? <AttentionDot /> : null}
		</span>
	);
}

function RowTreatments() {
	return (
		<Table
			head={["Session", "Row", "Markers"]}
			rows={FACTS.map((fact) => [
				<InlineMarkdown key="session" source={fact.session} />,
				<Row key="row" running={fact.running} attention={fact.attention} />,
				<span key="markers" className="tr-text-metadata text-text-muted">
					{[fact.running ? "RunningIcon" : "identity glyph", fact.attention ? "AttentionDot" : null]
						.filter(Boolean)
						.join(" + ")}
				</span>,
			])}
		/>
	);
}

export const attentionDotShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"The rail's two treatments from normalized host state, rendered with the real components. Attention is binary; working replaces the glyph; the two are orthogonal.",
			Render: RowTreatments,
		},
	],
};
