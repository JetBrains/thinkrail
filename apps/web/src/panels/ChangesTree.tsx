import type { GitFileChange } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { firstClickOnly } from "../lib";
import type { TabIntent } from "../store";
import { ChangeRowActions, ROW_MENU_SLOT } from "./ChangeRowActions";
import { buildChangesTree, type ChangeTreeNode, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { TreeRow } from "./TreeRow";
import { Tree } from "./treeNavigation";
import { ViewedMark } from "./ViewedMark";

interface ChangeRowProps {
	onOpen: (path: string, intent: TabIntent, claimPreview?: boolean) => void;
	isActive: (path: string) => boolean;
	isViewed: (path: string) => boolean;
	isCollapsed: (path: string) => boolean;
	onSetCollapsed: (path: string, collapsed: boolean) => void;
}

export function ChangesTree({
	changes,
	...rowProps
}: ChangeRowProps & { changes: readonly GitFileChange[] }) {
	const t = useT();
	return (
		<Tree
			label={t("changes.panel.label")}
			focusList="changes"
			className="flex flex-col motion-safe:animate-reveal"
			onOpenKept={(path) => rowProps.onOpen(path, "keep", true)}
		>
			{buildChangesTree(changes).map((node) => (
				<ChangeNodeRow key={node.path} node={node} level={1} {...rowProps} />
			))}
		</Tree>
	);
}

function ChangeNodeRow({
	node,
	level,
	...rowProps
}: ChangeRowProps & { node: ChangeTreeNode; level: number }) {
	const { onOpen, isActive, isViewed, isCollapsed, onSetCollapsed } = rowProps;

	if (node.kind === "file") {
		return (
			<li role="none" data-focus-row={node.path}>
				<ChangeRowActions
					path={node.path}
					active={isActive(node.path)}
					onView={() => onOpen(node.path, "preview")}
					onOpenTab={() => onOpen(node.path, "keep")}
				>
					{({ onContextMenu, onKeyDown }) => (
						<TreeRow
							testid="change-item"
							treeId={node.path}
							level={level}
							path={node.path}
							onContextMenu={onContextMenu}
							onKeyDown={onKeyDown}
							kind="file"
							highlight="wrapper"
							active={isActive(node.path)}
							dataStatus={node.status}
							dataViewed={isViewed(node.path)}
							label={node.name}
							labelClassName={`${statusNameClass(node.status)} ${isViewed(node.path) ? "opacity-60" : ""}`}
							onClick={firstClickOnly(() => onOpen(node.path, "preview"))}
							onDoubleClick={() => onOpen(node.path, "keep", true)}
							trailing={
								<>
									{isViewed(node.path) ? <ViewedMark /> : null}
									<DiffStatBadge added={node.added} removed={node.removed} />
								</>
							}
						/>
					)}
				</ChangeRowActions>
			</li>
		);
	}

	const expanded = !isCollapsed(node.path);
	return (
		<li role="none" data-focus-row={node.path}>
			<div className="flex min-w-0 items-center">
				<TreeRow
					testid="change-tree-folder"
					treeId={node.path}
					level={level}
					path={node.path}
					kind="dir"
					expanded={expanded}
					label={node.name}
					onClick={() => onSetCollapsed(node.path, expanded)}
					trailing={expanded ? null : <DiffStatBadge added={node.added} removed={node.removed} />}
				/>
				<span className={ROW_MENU_SLOT} />
			</div>
			{expanded && (
				<ul
					role="none"
					data-focus-list={`changes:${node.path}`}
					className="flex flex-col pl-tree-indent"
				>
					{node.children.map((child) => (
						<ChangeNodeRow key={child.path} node={child} level={level + 1} {...rowProps} />
					))}
				</ul>
			)}
		</li>
	);
}
