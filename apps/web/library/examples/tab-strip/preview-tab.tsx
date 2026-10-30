import { useRef, useState } from "react";
import { collectCenterGroups, type LayoutAttention } from "@/shell/layout/model";
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
	center: {
		kind: "group",
		id: "center",
		tabs: [
			{ kind: "file", id: "auth", name: "auth.ts", path: "src/auth.ts" },
			{ kind: "file", id: "session", name: "session.ts", path: "src/session.ts" },
		],
		previewTabId: "session",
	},
	left: { visible: true, width: 0.2, groups: [] },
	right: { visible: true, width: 0.25, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

export default function PreviewTab() {
	const [selectedId, setSelectedId] = useState("session");
	const [previewId, setPreviewId] = useState<string | undefined>("session");
	const selectionEpochRef = useRef(0);
	const tabs = collectCenterGroups(DOCUMENT.center)[0]?.tabs ?? [];
	return (
		<div className="w-full">
			<TabStrip
				document={DOCUMENT}
				readAttention={() => ATTENTION}
				selectionEpochRef={selectionEpochRef}
				location={{ area: "center", groupId: "center" }}
				tabs={tabs}
				selectedId={selectedId}
				previewId={previewId}
				maxSideGroups={6}
				maxBottomGroups={3}
				draggingTab={null}
				onSelect={(tabId, keep) => {
					setSelectedId(tabId);
					if (keep && tabId === previewId) setPreviewId(undefined);
				}}
				onClose={() => {}}
				onApply={() => {}}
				onFocusAdjacentGroup={() => {}}
				onHideSide={() => {}}
				onRevealTool={() => {}}
				onRenameChat={undefined}
				canFocusAdjacentGroup={false}
				renderTabAdornment={() => null}
			/>
		</div>
	);
}
