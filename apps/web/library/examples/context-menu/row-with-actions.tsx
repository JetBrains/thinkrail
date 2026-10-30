import { RiAddLine, RiFolderOpenLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { TreeRow } from "@/panels/TreeRow";

export default function RowWithActions() {
	const t = useT();
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className="flex w-224 items-center gap-4">
					<TreeRow testid="project-item" kind="dir" label="thinkrail" onClick={() => {}} />
					<IconButton
						icon={RiAddLine}
						label={t("panels.projectTree.createWorkspace")}
						size="s"
						className="shrink-0"
						onClick={() => {}}
					/>
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
			</ContextMenuContent>
		</ContextMenu>
	);
}
