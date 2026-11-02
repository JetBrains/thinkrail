import type { GitFileStatus } from "@thinkrail/contracts";
import { useState } from "react";
import { firstClickOnly } from "@/lib";
import { statusNameClass } from "@/panels/changesModel";
import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { TreeRow } from "@/panels/TreeRow";

interface Change {
	path: string;
	name: string;
	status: GitFileStatus;
	added: number;
	removed: number;
}

const folders: { path: string; name: string; files: Change[] }[] = [
	{
		path: "src/panels",
		name: "src/panels",
		files: [
			{
				path: "src/panels/TreeRow.tsx",
				name: "TreeRow.tsx",
				status: "modified",
				added: 12,
				removed: 4,
			},
			{
				path: "src/panels/FileTree.tsx",
				name: "FileTree.tsx",
				status: "added",
				added: 86,
				removed: 0,
			},
			{
				path: "src/panels/OldTree.tsx",
				name: "OldTree.tsx",
				status: "deleted",
				added: 0,
				removed: 140,
			},
		],
	},
	{
		path: "docs",
		name: "docs",
		files: [{ path: "docs/tree.md", name: "tree.md", status: "renamed", added: 3, removed: 1 }],
	},
];

const total = (files: Change[], key: "added" | "removed") =>
	files.reduce((sum, file) => sum + file[key], 0);

export default function ChangesTree() {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(["docs"]));
	const [activePath, setActivePath] = useState("src/panels/TreeRow.tsx");
	const toggle = (path: string) =>
		setCollapsed((current) => {
			const next = new Set(current);
			if (!next.delete(path)) next.add(path);
			return next;
		});
	return (
		<ul className="flex w-full max-w-[20rem] flex-col">
			{folders.map((folder) => {
				const expanded = !collapsed.has(folder.path);
				return (
					<li key={folder.path}>
						<TreeRow
							testid="change-tree-folder"
							kind="dir"
							expanded={expanded}
							label={folder.name}
							onClick={() => toggle(folder.path)}
							trailing={
								expanded ? null : (
									<DiffStatBadge
										added={total(folder.files, "added")}
										removed={total(folder.files, "removed")}
									/>
								)
							}
						/>
						{expanded && (
							<ul className="flex flex-col pl-tree-indent">
								{folder.files.map((file) => (
									<li key={file.path}>
										<TreeRow
											testid="change-item"
											kind="file"
											active={activePath === file.path}
											dataStatus={file.status}
											label={file.name}
											labelClassName={statusNameClass(file.status)}
											onClick={firstClickOnly(() => setActivePath(file.path))}
											trailing={<DiffStatBadge added={file.added} removed={file.removed} />}
										/>
									</li>
								))}
							</ul>
						)}
					</li>
				);
			})}
		</ul>
	);
}
