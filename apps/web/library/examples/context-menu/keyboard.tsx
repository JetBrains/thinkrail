import { RiAddLine, RiFolderOpenLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import type { KeyboardEvent } from "react";
import { TreeRow } from "@/panels/TreeRow";

function openFromKeyboard(event: KeyboardEvent<HTMLElement>) {
	if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
	event.preventDefault();
	const rect = event.currentTarget.getBoundingClientRect();
	event.currentTarget.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left, clientY: rect.bottom }),
	);
}

export default function Keyboard() {
	const t = useT();
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild onKeyDown={openFromKeyboard}>
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
			</ContextMenuContent>
		</ContextMenu>
	);
}
