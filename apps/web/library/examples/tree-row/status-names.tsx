import type { GitFileStatus } from "@thinkrail/contracts";
import { statusNameClass } from "@/panels/changesModel";
import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { TreeRow } from "@/panels/TreeRow";
import { ViewedMark } from "@/panels/ViewedMark";

const changes: { name: string; status: GitFileStatus; viewed?: boolean }[] = [
	{ name: "added.ts", status: "added" },
	{ name: "untracked.ts", status: "untracked" },
	{ name: "modified.ts", status: "modified" },
	{ name: "renamed.ts", status: "renamed" },
	{ name: "deleted.ts", status: "deleted" },
	{ name: "viewed.ts", status: "modified", viewed: true },
];

export default function StatusNames() {
	return (
		<ul className="flex w-full max-w-[18rem] flex-col">
			{changes.map((change) => (
				<li key={change.name}>
					<TreeRow
						testid="change-item"
						kind="file"
						dataStatus={change.status}
						dataViewed={change.viewed === true}
						label={change.name}
						labelClassName={`${statusNameClass(change.status)} ${change.viewed ? "opacity-60" : ""}`}
						trailing={
							<>
								{change.viewed ? <ViewedMark /> : null}
								<DiffStatBadge added={4} removed={2} />
							</>
						}
					/>
				</li>
			))}
		</ul>
	);
}
