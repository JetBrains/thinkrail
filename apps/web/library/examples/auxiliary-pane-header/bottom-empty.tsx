import { useT } from "@thinkrail/locales/react";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";
import { toolTab } from "@/shell/layout/model";
import type { WorkspaceLayoutDocument } from "@/shell/layout/types";
import { groupPanelId } from "@/shell/layout/workbenchShared";
import { SideGroupMenu } from "@/shell/layout/workbenchSide";

const DOCUMENT: WorkspaceLayoutDocument = {
	version: 2,
	center: { kind: "group", id: "center", tabs: [] },
	left: {
		visible: true,
		width: 0.2,
		groups: [{ id: "left", weight: 1, folded: false, tabs: [toolTab("projects")] }],
	},
	right: {
		visible: true,
		width: 0.25,
		groups: [{ id: "right", weight: 1, folded: false, tabs: [toolTab("files")] }],
	},
	bottom: {
		visible: true,
		height: 0.3,
		alignment: "center",
		groups: [{ id: "bottom", weight: 1, folded: false, tabs: [] }],
	},
	toolRestoreTargets: {},
};

export default function BottomEmpty() {
	const t = useT();
	const group = DOCUMENT.bottom.groups[0];
	return (
		<div className="w-full">
			<AuxiliaryPaneHeader
				title={t("workbench.rail.terminal")}
				actions={
					<>
						{group ? (
							<SideGroupMenu
								document={DOCUMENT}
								side="bottom"
								group={group}
								limit={3}
								onNewTerminal={() => {}}
								onRevealTool={() => {}}
							/>
						) : null}
						<AuxiliaryPaneHideButton
							testId="bottom-group-fold"
							controls={groupPanelId({ area: "bottom", groupId: "bottom" })}
							onClick={() => {}}
						/>
					</>
				}
			/>
		</div>
	);
}
