import { useState } from "react";
import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { TreeRow } from "@/panels/TreeRow";

const FILES = [
	{ name: "Composer.tsx", added: 42, removed: 17 },
	{ name: "FileChip.tsx", added: 8, removed: 0 },
	{ name: "promptImages.tsx", added: 0, removed: 5 },
];
const TOTAL = FILES.reduce(
	(sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }),
	{ added: 0, removed: 0 },
);

export default function Tree() {
	const [expanded, setExpanded] = useState(false);
	return (
		<ul className="flex w-full max-w-[20rem] flex-col">
			<li>
				<TreeRow
					testid="change-tree-folder"
					kind="dir"
					expanded={expanded}
					label="src/chat"
					onClick={() => setExpanded((value) => !value)}
					trailing={expanded ? null : <DiffStatBadge added={TOTAL.added} removed={TOTAL.removed} />}
				/>
				{expanded ? (
					<ul className="flex flex-col pl-tree-indent">
						{FILES.map((file) => (
							<li key={file.name}>
								<TreeRow
									testid="change-item"
									kind="file"
									label={file.name}
									onClick={() => {}}
									trailing={<DiffStatBadge added={file.added} removed={file.removed} />}
								/>
							</li>
						))}
					</ul>
				) : null}
			</li>
		</ul>
	);
}
