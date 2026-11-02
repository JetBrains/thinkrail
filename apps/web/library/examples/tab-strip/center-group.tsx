import { RiChatNewLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
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

const INITIAL: WorkspaceLayoutDocument = {
	version: 2,
	center: {
		kind: "group",
		id: "center",
		tabs: [
			{ kind: "chat", id: "chat", name: "Fix login redirect", sessionId: "s1" },
			{ kind: "file", id: "auth", name: "auth.ts", path: "src/auth.ts" },
			{ kind: "changes", id: "changes", name: "", scope: { kind: "uncommitted" } },
			{
				kind: "document",
				id: "plan",
				name: "Fix login redirect",
				documentKind: "todo-plan",
				sourceId: "s1",
				docPath: "plan.md",
			},
		],
	},
	left: { visible: true, width: 0.2, groups: [] },
	right: { visible: true, width: 0.25, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

export default function CenterGroup() {
	const t = useT();
	const [document, setDocument] = useState(INITIAL);
	const [selectedId, setSelectedId] = useState("chat");
	const selectionEpochRef = useRef(0);
	const tabs = collectCenterGroups(document.center)[0]?.tabs ?? [];
	return (
		<div className="w-full">
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
				onClose={(tab) => {
					const next = closeLayoutTab(document, tab.id).document;
					setDocument(next);
					const rest = collectCenterGroups(next.center)[0]?.tabs ?? [];
					if (tab.id === selectedId && rest[0]) setSelectedId(rest[0].id);
				}}
				onApply={(result) => setDocument(result.document)}
				onFocusAdjacentGroup={() => {}}
				onHideSide={() => {}}
				onRevealTool={() => {}}
				onRenameChat={undefined}
				canFocusAdjacentGroup={false}
				renderTabAdornment={() => null}
				trailing={
					<IconButton
						variant="ghost"
						size="m"
						icon={RiChatNewLine}
						label={t("workbench.center.newChat")}
						onClick={() => {}}
						className="shrink-0 self-center"
					/>
				}
			/>
		</div>
	);
}
