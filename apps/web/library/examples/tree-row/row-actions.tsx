import { useState } from "react";
import { firstClickOnly } from "@/lib";
import { ChangeRowActions } from "@/panels/ChangeRowActions";
import { statusNameClass } from "@/panels/changesModel";
import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { TreeRow } from "@/panels/TreeRow";

const changes = [
	{
		path: "src/panels/TreeRow.tsx",
		name: "TreeRow.tsx",
		status: "modified",
		added: 12,
		removed: 4,
	},
	{ path: "src/panels/FileTree.tsx", name: "FileTree.tsx", status: "added", added: 86, removed: 0 },
] as const;

export default function RowActions() {
	const [activePath, setActivePath] = useState<string>(changes[0].path);
	return (
		<ul className="flex w-full max-w-[20rem] flex-col">
			{changes.map((change) => (
				<li key={change.path}>
					<ChangeRowActions
						path={change.path}
						active={activePath === change.path}
						onView={() => setActivePath(change.path)}
						onOpenTab={() => setActivePath(change.path)}
					>
						{({ onContextMenu }) => (
							<TreeRow
								testid="change-item"
								kind="file"
								highlight="wrapper"
								active={activePath === change.path}
								dataStatus={change.status}
								label={change.name}
								labelClassName={statusNameClass(change.status)}
								onClick={firstClickOnly(() => setActivePath(change.path))}
								onContextMenu={onContextMenu}
								trailing={<DiffStatBadge added={change.added} removed={change.removed} />}
							/>
						)}
					</ChangeRowActions>
				</li>
			))}
		</ul>
	);
}
