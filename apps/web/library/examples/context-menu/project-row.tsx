import { RiAddLine, RiCloseLine, RiFolderOpenLine, RiPencilLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { TreeRow } from "@/panels/TreeRow";

export default function ProjectRow() {
	const t = useT();
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className="w-224">
					<TreeRow testid="project-item" kind="dir" label="thinkrail" onClick={() => {}} />
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => {}}>
					<RiAddLine />
					{t("panels.projectTree.createWorkspace")}
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => {}}>
					<RiFolderOpenLine />
					{t("panels.projectTree.openExistingWorktree")}
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={() => {}}>
					<RiPencilLine />
					{t("common.rename")}
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => {}}>
					<RiCloseLine />
					{t("panels.projectTree.closeProject")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
