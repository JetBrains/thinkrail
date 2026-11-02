import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { TreeRow } from "@/panels/TreeRow";

export default function TabActions() {
	const t = useT();
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className="w-224">
					<TreeRow testid="editor-tab" kind="file" label="PlanPane.tsx" onClick={() => {}} />
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => {}}>{t("workbench.tab.focus")}</ContextMenuItem>
				<ContextMenuItem disabled onSelect={() => {}}>
					{t("workbench.tab.keepPreviewUnavailable")}
				</ContextMenuItem>
				<ContextMenuItem disabled onSelect={() => {}}>
					{t("workbench.tab.moveLeftFirst")}
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => {}}>{t("workbench.tab.moveRight")}</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={() => {}}>{t("workbench.center.splitRight")}</ContextMenuItem>
				<ContextMenuItem onSelect={() => {}}>{t("workbench.center.splitDown")}</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={() => {}}>
					{t("workbench.tab.moveToRightPane", { group: "Files" })}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
