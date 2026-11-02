import { useRef, useState } from "react";
import { AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";
import {
	closeLayoutTab,
	type LayoutAttention,
	type LayoutGroupLocation,
	toolTab,
} from "@/shell/layout/model";
import type { LayoutTerminalTab, WorkspaceLayoutDocument } from "@/shell/layout/types";
import { groupPanelId } from "@/shell/layout/workbenchShared";
import { SideGroupMenu } from "@/shell/layout/workbenchSide";
import { TabStrip } from "@/shell/layout/workbenchTabs";

const ATTENTION: LayoutAttention = {
	selectedByGroup: {},
	lastFocusedCenterGroupId: "center",
	lastFocusedSideGroupId: {},
	navigationClockByGroup: {},
};

const LOCATION: LayoutGroupLocation = { area: "bottom", groupId: "terminals" };

const terminal = (index: number): LayoutTerminalTab => ({
	kind: "terminal",
	id: `terminal-${index}`,
	name: `Terminal ${index}`,
	tabKey: `t${index}`,
});

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
			{
				id: "right",
				weight: 1,
				folded: false,
				tabs: [toolTab("specs"), toolTab("files"), toolTab("review"), toolTab("plan")],
			},
		],
	},
	bottom: {
		visible: true,
		height: 0.3,
		alignment: "center",
		groups: [{ id: "terminals", weight: 1, folded: false, tabs: [terminal(1), terminal(2)] }],
	},
	toolRestoreTargets: {},
};

export default function TerminalStrip() {
	const [document, setDocument] = useState(INITIAL);
	const [selectedId, setSelectedId] = useState("terminal-1");
	const selectionEpochRef = useRef(0);
	const group = document.bottom.groups[0];
	const tabs = group?.tabs ?? [];
	const addTerminal = () => {
		const next = terminal(tabs.length + 1);
		setDocument((current) => ({
			...current,
			bottom: {
				...current.bottom,
				groups: current.bottom.groups.map((group) => ({ ...group, tabs: [...group.tabs, next] })),
			},
		}));
		setSelectedId(next.id);
	};
	return (
		<div className="w-full">
			<TabStrip
				document={document}
				readAttention={() => ATTENTION}
				selectionEpochRef={selectionEpochRef}
				location={LOCATION}
				tabs={tabs}
				selectedId={selectedId}
				maxSideGroups={6}
				maxBottomGroups={3}
				draggingTab={null}
				onSelect={setSelectedId}
				onClose={(tab) => setDocument((current) => closeLayoutTab(current, tab.id).document)}
				onApply={(result) => setDocument(result.document)}
				onFocusAdjacentGroup={() => {}}
				onHideSide={() => {}}
				onRevealTool={() => {}}
				onRenameChat={undefined}
				canFocusAdjacentGroup={false}
				renderTabAdornment={() => null}
				trailing={
					<>
						{group ? (
							<SideGroupMenu
								document={document}
								side="bottom"
								group={group}
								limit={3}
								onNewTerminal={addTerminal}
								onRevealTool={() => {}}
							/>
						) : null}
						<AuxiliaryPaneHideButton
							testId="bottom-group-fold"
							controls={groupPanelId(LOCATION)}
							onClick={() => {}}
						/>
					</>
				}
			/>
		</div>
	);
}
