import { useT } from "@thinkrail/locales/react";
import { DiffStatBadge } from "@/panels/DiffStatBadge";

const REVISIONS = [
	{ sha: "3f9c2e1a", stat: { added: 120, removed: 14 } },
	{ sha: "b81d07c4", stat: null },
	{ sha: "e4a5f9d2", stat: { added: 9, removed: 22 }, unreviewed: true },
];

export default function Revisions() {
	const t = useT();
	return (
		<ol className="flex flex-col gap-4">
			{REVISIONS.map((rev, index) => (
				<li key={rev.sha} className="flex items-center gap-8">
					<span className="tr-text-metadata text-text-muted">#{index + 1}</span>
					<span className="tr-code-text text-text-subtle">{rev.sha.slice(0, 7)}</span>
					{rev.stat ? <DiffStatBadge added={rev.stat.added} removed={rev.stat.removed} /> : null}
					{rev.unreviewed ? (
						<span className="tr-text-metadata text-feedback-warning">
							{t("plan.revisions.unreviewed")}
						</span>
					) : null}
				</li>
			))}
		</ol>
	);
}
