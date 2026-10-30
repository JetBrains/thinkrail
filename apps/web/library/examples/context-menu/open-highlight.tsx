import { RiFileCopyLine, RiFolderOpenLine, RiPencilLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { useState } from "react";
import { TreeRow } from "@/panels/TreeRow";

export default function OpenHighlight() {
	const t = useT();
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<ContextMenuTrigger asChild>
				<div className="w-224">
					<TreeRow
						testid="project-item"
						kind="dir"
						label="design-tokens"
						active={menuOpen}
						onClick={() => {}}
					/>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => {}}>
					<RiPencilLine />
					{t("common.rename")}
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => {}}>
					<RiFileCopyLine />
					{t("panels.projectTree.copyPath")}
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => {}}>
					<RiFolderOpenLine />
					{t("panels.projectTree.reveal")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
