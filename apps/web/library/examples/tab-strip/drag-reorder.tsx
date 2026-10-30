import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	pointerWithin,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useRef, useState } from "react";
import {
	collectCenterGroups,
	isLayoutUnavailable,
	type LayoutAttention,
	moveTabToGroup,
} from "@/shell/layout/model";
import type { LayoutTab, WorkspaceLayoutDocument } from "@/shell/layout/types";
import type { DragData, DropTarget } from "@/shell/layout/workbenchShared";
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
			{ kind: "file", id: "auth", name: "auth.ts", path: "src/auth.ts" },
			{ kind: "file", id: "session", name: "session.ts", path: "src/session.ts" },
			{ kind: "file", id: "routes", name: "routes.tsx", path: "src/routes.tsx" },
		],
	},
	left: { visible: true, width: 0.2, groups: [] },
	right: { visible: true, width: 0.25, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

export default function DragReorder() {
	const [document, setDocument] = useState(INITIAL);
	const [selectedId, setSelectedId] = useState("auth");
	const [draggingTab, setDraggingTab] = useState<LayoutTab | null>(null);
	const selectionEpochRef = useRef(0);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const tabs = collectCenterGroups(document.center)[0]?.tabs ?? [];
	const drop = (event: DragEndEvent) => {
		const tab = draggingTab;
		setDraggingTab(null);
		const target = event.over?.data.current?.target as DropTarget | undefined;
		if (!tab || target?.kind !== "insert") return;
		const from = tabs.findIndex((candidate) => candidate.id === tab.id);
		const index = from >= 0 && from < target.index ? target.index - 1 : target.index;
		const result = moveTabToGroup(document, tab, target.location, index);
		if (!isLayoutUnavailable(result)) setDocument(result.document);
	};
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={pointerWithin}
			onDragStart={(event) => setDraggingTab((event.active.data.current as DragData).tab)}
			onDragCancel={() => setDraggingTab(null)}
			onDragEnd={drop}
		>
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
					draggingTab={draggingTab}
					onSelect={setSelectedId}
					onClose={() => {}}
					onApply={(result) => setDocument(result.document)}
					onFocusAdjacentGroup={() => {}}
					onHideSide={() => {}}
					onRevealTool={() => {}}
					onRenameChat={undefined}
					canFocusAdjacentGroup={false}
					renderTabAdornment={() => null}
				/>
			</div>
		</DndContext>
	);
}
