import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";
import { TreeRow } from "@/panels/TreeRow";

export default function ConfirmAfterMenu() {
	const t = useT();
	const rowRef = useRef<HTMLButtonElement>(null);
	const openingDialogRef = useRef(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const openDialogAfterMenu = (openDialog: () => void) => {
		openingDialogRef.current = true;
		setMenuOpen(false);
		requestAnimationFrame(openDialog);
	};
	return (
		<>
			<ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<ContextMenuTrigger asChild>
					<div className="w-224">
						<TreeRow
							ref={rowRef}
							testid="project-item"
							kind="dir"
							label="thinkrail"
							onClick={() => {}}
						/>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (!openingDialogRef.current) rowRef.current?.focus();
						openingDialogRef.current = false;
					}}
				>
					<ContextMenuItem
						onSelect={(event) => {
							event.preventDefault();
							openDialogAfterMenu(() => setConfirmOpen(true));
						}}
					>
						<RiCloseLine />
						{t("panels.projectTree.closeProject")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={t("panels.projectTree.closeTitle", { name: "thinkrail" })}
				description={t("panels.projectTree.closeDescription")}
				confirmLabel={t("panels.projectTree.closeProject")}
				onConfirm={() => {}}
				onClosedAutoFocus={() => rowRef.current?.focus()}
			/>
		</>
	);
}
