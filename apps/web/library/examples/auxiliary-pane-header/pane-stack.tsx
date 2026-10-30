import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useState } from "react";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";
import {
	isLayoutUnavailable,
	layoutTabName,
	removeLayoutGroup,
	toolTab,
} from "@/shell/layout/model";
import type { WorkspaceLayoutDocument } from "@/shell/layout/types";
import { groupPanelId } from "@/shell/layout/workbenchShared";
import { SideGroupMenu } from "@/shell/layout/workbenchSide";

const INITIAL: WorkspaceLayoutDocument = {
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
		groups: [
			{ id: "tools", weight: 0.5, folded: false, tabs: [toolTab("files"), toolTab("review")] },
			{ id: "empty", weight: 0.5, folded: false, tabs: [] },
		],
	},
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

export default function PaneStack() {
	const t = useT();
	const [document, setDocument] = useState(INITIAL);
	return (
		<div className="flex w-full flex-col gap-8">
			{document.right.groups.map((group) => {
				const location = { area: "right", groupId: group.id } as const;
				const selected = group.tabs[0];
				const removal = removeLayoutGroup(t, document, location);
				return (
					<AuxiliaryPaneHeader
						key={group.id}
						title={selected ? layoutTabName(t, selected) : t("workbench.pane.tools")}
						{...(selected?.kind === "tool" ? { dragTab: selected } : {})}
						data-group-id={group.id}
						actions={
							<>
								<SideGroupMenu
									document={document}
									side="right"
									group={group}
									limit={6}
									onNewTerminal={() => {}}
									onRevealTool={() => {}}
								/>
								{group.tabs.length === 0 ? (
									<IconButton
										variant="ghost"
										size="m"
										icon={RiCloseLine}
										label={t("workbench.group.remove")}
										tooltip={
											isLayoutUnavailable(removal) ? removal.reason : t("workbench.group.remove")
										}
										wrapTrigger
										disabled={isLayoutUnavailable(removal)}
										onClick={() => {
											if (!isLayoutUnavailable(removal)) setDocument(removal.document);
										}}
										className="shrink-0 self-center"
									/>
								) : null}
								<AuxiliaryPaneHideButton
									testId="side-group-fold"
									controls={groupPanelId(location)}
									onClick={() => {}}
								/>
							</>
						}
					/>
				);
			})}
		</div>
	);
}
