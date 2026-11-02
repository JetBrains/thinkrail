import type { GitFileStatus } from "@thinkrail/contracts";
import { useState } from "react";
import { statusLetter } from "@/chat/planView";
import { firstClickOnly } from "@/lib";
import { statusMarkClass } from "@/panels/changesModel";
import { TreeRow } from "@/panels/TreeRow";

interface Node {
	path: string;
	name: string;
	kind: "dir" | "file";
	ignored?: boolean;
	status?: GitFileStatus;
	changed?: boolean;
	children?: Node[];
}

const nodes: Node[] = [
	{ path: "dist", name: "dist", kind: "dir", ignored: true, children: [] },
	{
		path: "src",
		name: "src",
		kind: "dir",
		changed: true,
		children: [
			{ path: "src/App.tsx", name: "App.tsx", kind: "file", status: "modified" },
			{ path: "src/routes.ts", name: "routes.ts", kind: "file", status: "added" },
			{ path: "src/main.tsx", name: "main.tsx", kind: "file" },
		],
	},
	{ path: ".env.local", name: ".env.local", kind: "file", ignored: true },
	{ path: "package.json", name: "package.json", kind: "file" },
];

export default function FilesTree() {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(["src"]));
	const [activePath, setActivePath] = useState<string | null>("src/App.tsx");
	const toggle = (path: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(path)) next.add(path);
			return next;
		});

	const renderNode = (node: Node) => {
		const isDir = node.kind === "dir";
		const open = expanded.has(node.path);
		return (
			<li key={node.path}>
				<TreeRow
					testid="file-node"
					kind={node.kind}
					expanded={open}
					active={!isDir && activePath === node.path}
					subtle={node.ignored === true}
					dataStatus={node.ignored ? "ignored" : undefined}
					label={node.name}
					labelClassName={
						node.status
							? statusMarkClass(node.status)
							: node.changed
								? statusMarkClass("modified")
								: ""
					}
					trailing={
						node.status ? (
							<span className={`shrink-0 tr-text-metadata ${statusMarkClass(node.status)}`}>
								{statusLetter(node.status)}
							</span>
						) : node.changed ? (
							<span className="mr-4 size-6 shrink-0 rounded-full bg-feedback-warning" />
						) : undefined
					}
					onClick={isDir ? () => toggle(node.path) : firstClickOnly(() => setActivePath(node.path))}
				/>
				{isDir && open && node.children && (
					<ul className="flex flex-col pl-tree-indent">{node.children.map(renderNode)}</ul>
				)}
			</li>
		);
	};

	return <ul className="flex w-full max-w-[18rem] flex-col">{nodes.map(renderNode)}</ul>;
}
