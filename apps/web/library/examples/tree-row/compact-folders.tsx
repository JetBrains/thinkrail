import { useState } from "react";
import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { TreeRow } from "@/panels/TreeRow";

export default function CompactFolders() {
	const [expanded, setExpanded] = useState(true);
	return (
		<ul className="flex w-full max-w-[14rem] flex-col">
			<li>
				<TreeRow
					testid="file-node"
					kind="dir"
					expanded={expanded}
					label="apps/web/src/panels"
					onClick={() => setExpanded((open) => !open)}
				/>
				{expanded && (
					<ul className="flex flex-col pl-tree-indent">
						<li>
							<TreeRow
								testid="file-node"
								kind="file"
								label="WorkspaceFilesPanelToolbar.tsx"
								trailing={<DiffStatBadge added={128} removed={37} />}
							/>
						</li>
						<li>
							<TreeRow testid="file-node" kind="file" label="TreeRow.tsx" />
						</li>
					</ul>
				)}
			</li>
		</ul>
	);
}
