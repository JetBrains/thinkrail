import { useRef, useState } from "react";
import { collectCenterGroups, type LayoutAttention } from "@/shell/layout/model";
import type { LayoutCenterTab, WorkspaceLayoutDocument } from "@/shell/layout/types";
import { TabStrip } from "@/shell/layout/workbenchTabs";

const ATTENTION: LayoutAttention = {
	selectedByGroup: {},
	lastFocusedCenterGroupId: "center",
	lastFocusedSideGroupId: {},
	navigationClockByGroup: {},
};

const FIRST_PROMPTS = { s2: "Why does the login page redirect twice after signing in?" };

const withTabs = (tabs: LayoutCenterTab[]): WorkspaceLayoutDocument => ({
	version: 2,
	center: { kind: "group", id: "center", tabs },
	left: { visible: true, width: 0.2, groups: [] },
	right: { visible: true, width: 0.25, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
});

export default function RenameChat() {
	const [tabs, setTabs] = useState<LayoutCenterTab[]>([
		{ kind: "chat", id: "c1", name: "Refactor session store", sessionId: "s1" },
		{ kind: "chat", id: "c2", name: "", sessionId: "s2" },
	]);
	const [selectedId, setSelectedId] = useState("c1");
	const selectionEpochRef = useRef(0);
	const document = withTabs(tabs);
	return (
		<div className="w-full">
			<TabStrip
				document={document}
				readAttention={() => ATTENTION}
				selectionEpochRef={selectionEpochRef}
				location={{ area: "center", groupId: "center" }}
				tabs={collectCenterGroups(document.center)[0]?.tabs ?? []}
				selectedId={selectedId}
				maxSideGroups={6}
				maxBottomGroups={3}
				draggingTab={null}
				onSelect={setSelectedId}
				onClose={() => {}}
				onApply={() => {}}
				onFocusAdjacentGroup={() => {}}
				onHideSide={() => {}}
				onRevealTool={() => {}}
				onRenameChat={(sessionId, titleInput) =>
					setTabs((current) =>
						current.map((tab) =>
							tab.kind === "chat" && tab.sessionId === sessionId
								? { ...tab, name: titleInput.trim() }
								: tab,
						),
					)
				}
				chatFirstPrompts={FIRST_PROMPTS}
				canFocusAdjacentGroup={false}
				renderTabAdornment={() => null}
			/>
		</div>
	);
}
