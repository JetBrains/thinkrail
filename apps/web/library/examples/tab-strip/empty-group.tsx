import { RiChatNewLine, RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useRef } from "react";
import { isLayoutUnavailable, type LayoutAttention, removeLayoutGroup } from "@/shell/layout/model";
import type { WorkspaceLayoutDocument } from "@/shell/layout/types";
import { TabStrip } from "@/shell/layout/workbenchTabs";

const ATTENTION: LayoutAttention = {
	selectedByGroup: {},
	lastFocusedCenterGroupId: "center",
	lastFocusedSideGroupId: {},
	navigationClockByGroup: {},
};

const DOCUMENT: WorkspaceLayoutDocument = {
	version: 2,
	center: { kind: "group", id: "center", tabs: [] },
	left: { visible: true, width: 0.2, groups: [] },
	right: { visible: true, width: 0.25, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

export default function EmptyGroup() {
	const t = useT();
	const selectionEpochRef = useRef(0);
	const removal = removeLayoutGroup(t, DOCUMENT, { area: "center", groupId: "center" });
	return (
		<div className="w-full">
			<TabStrip
				document={DOCUMENT}
				readAttention={() => ATTENTION}
				selectionEpochRef={selectionEpochRef}
				location={{ area: "center", groupId: "center" }}
				tabs={[]}
				maxSideGroups={6}
				maxBottomGroups={3}
				draggingTab={null}
				onSelect={() => {}}
				onClose={() => {}}
				onApply={() => {}}
				onFocusAdjacentGroup={() => {}}
				onHideSide={() => {}}
				onRevealTool={() => {}}
				onRenameChat={undefined}
				canFocusAdjacentGroup={false}
				renderTabAdornment={() => null}
				trailing={
					<>
						<IconButton
							variant="ghost"
							size="m"
							icon={RiCloseLine}
							label={t("workbench.group.remove")}
							tooltip={isLayoutUnavailable(removal) ? removal.reason : t("workbench.group.remove")}
							wrapTrigger
							disabled={isLayoutUnavailable(removal)}
							onClick={() => {}}
							className="shrink-0 self-center"
						/>
						<IconButton
							variant="ghost"
							size="m"
							icon={RiChatNewLine}
							label={t("workbench.center.newChat")}
							onClick={() => {}}
							className="shrink-0 self-center"
						/>
					</>
				}
			/>
		</div>
	);
}
