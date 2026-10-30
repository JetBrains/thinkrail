import { useRef, useState } from "react";
import { closeLayoutTab, collectCenterGroups, type LayoutAttention } from "@/shell/layout/model";
import type { WorkspaceLayoutDocument } from "@/shell/layout/types";
import { TabStrip } from "@/shell/layout/workbenchTabs";

const ATTENTION: LayoutAttention = {
	selectedByGroup: {},
	lastFocusedCenterGroupId: "center",
	lastFocusedSideGroupId: {},
	navigationClockByGroup: {},
};

const FILES = [
	"auth.ts",
	"session.ts",
	"routes.tsx",
	"login.tsx",
	"api.ts",
	"store.ts",
	"theme.css",
];

const INITIAL: WorkspaceLayoutDocument = {
	version: 2,
	center: {
		kind: "group",
		id: "center",
		tabs: FILES.map((name) => ({ kind: "file", id: name, name, path: `src/${name}` })),
	},
	left: { visible: true, width: 0.2, groups: [] },
	right: { visible: true, width: 0.25, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

export default function Overflow() {
	const [document, setDocument] = useState(INITIAL);
	const [selectedId, setSelectedId] = useState("login.tsx");
	const selectionEpochRef = useRef(0);
	const tabs = collectCenterGroups(document.center)[0]?.tabs ?? [];
	return (
		<div className="w-full max-w-[24rem]">
			<TabStrip
				document={document}
				readAttention={() => ATTENTION}
				selectionEpochRef={selectionEpochRef}
				location={{ area: "center", groupId: "center" }}
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
			/>
		</div>
	);
}
