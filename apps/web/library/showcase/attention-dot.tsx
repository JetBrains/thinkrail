import { RiGitBranchLine } from "@remixicon/react";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";
import { Table } from "../parts/Section";
import type { Showcase } from "./types";

const ROWS = [
	{ label: "Quiet", running: false, attention: false },
	{ label: "Working", running: true, attention: false },
	{ label: "Waiting", running: false, attention: true },
	{ label: "Unread", running: false, attention: true },
	{ label: "Waiting while running", running: true, attention: true },
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
			head={["Session", "Row"]}
			rows={ROWS.map((row) => [
				row.label,
				<Row key="row" running={row.running} attention={row.attention} />,
			])}
		/>
	);
}

export const attentionDotShowcase: Showcase = {
	sections: [{ id: "states", Render: RowTreatments }],
};
