import { useRef, useState } from "react";
import { AuxiliaryRail } from "@/shell/layout/AuxiliaryRail";
import {
	type AuxiliaryRailEntry,
	activateAuxiliaryRailEntry,
	projectAuxiliaryRail,
} from "@/shell/layout/auxiliaryPresentation";
import {
	isLayoutUnavailable,
	type LayoutAttention,
	type LayoutGroupLocation,
	toolTab,
} from "@/shell/layout/model";
import type { WorkspaceLayoutDocument } from "@/shell/layout/types";
import { groupPanelId } from "@/shell/layout/workbenchShared";
import { WorkbenchTab } from "@/shell/layout/workbenchTabs";

const INITIAL: WorkspaceLayoutDocument = {
	version: 2,
	center: { kind: "group", id: "center", tabs: [] },
	left: {
		visible: true,
		width: 0.2,
		groups: [
			{
				id: "tools",
				weight: 1,
				folded: false,
				tabs: [toolTab("projects"), toolTab("specs"), toolTab("files")],
			},
		],
	},
	right: { visible: true, width: 0.25, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

const LOCATION: LayoutGroupLocation = { area: "left", groupId: "tools" };

export default function RailEntry() {
	const [document, setDocument] = useState(INITIAL);
	const [attention, setAttention] = useState<LayoutAttention>({
		selectedByGroup: { tools: "tool:projects" },
		lastFocusedCenterGroupId: "center",
		lastFocusedSideGroupId: { left: "tools" },
		navigationClockByGroup: {},
	});
	const selectionEpochRef = useRef(0);
	const tabs = document.left.groups[0]?.tabs ?? [];
	const activate = (entry: AuxiliaryRailEntry) => {
		const result = activateAuxiliaryRailEntry(document, attention, entry, 6, 3);
		if (isLayoutUnavailable(result)) return;
		setDocument(result.document);
		const focusTabId = result.focusTabId;
		if (focusTabId)
			setAttention((current) => ({
				...current,
				selectedByGroup: { ...current.selectedByGroup, tools: focusTabId },
			}));
	};
	return (
		<div className="flex h-[9rem]">
			<AuxiliaryRail
				region="left"
				entries={projectAuxiliaryRail(document, attention, "left")}
				renderEntry={(entry, control) =>
					entry.kind === "tool" && entry.tab ? (
						<WorkbenchTab
							tab={entry.tab}
							index={tabs.findIndex((tab) => tab.id === entry.tab?.id)}
							rail={{
								...control,
								entryKey: entry.key,
								vertical: true,
								beforeIndex: tabs.findIndex((tab) => tab.id === entry.tab?.id),
								afterIndex: tabs.findIndex((tab) => tab.id === entry.tab?.id) + 1,
								onActivate: () => activate(entry),
							}}
							location={LOCATION}
							readAttention={() => attention}
							selectionEpochRef={selectionEpochRef}
							active={entry.selected && entry.expanded}
							preview={false}
							document={document}
							maxSideGroups={6}
							maxBottomGroups={3}
							register={() => {}}
							onSelect={() => {}}
							onClose={() => {}}
							onApply={(result) => setDocument(result.document)}
							onFocusAdjacentGroup={() => {}}
							onHideSide={() => {}}
							onRevealTool={() => {}}
							onRenameChat={undefined}
							canFocusAdjacentGroup={false}
							renderTabAdornment={() => null}
							draggingTab={null}
							panelId={groupPanelId(LOCATION)}
							onKeyDown={() => {}}
						/>
					) : null
				}
			/>
		</div>
	);
}
