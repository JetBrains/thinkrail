import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useT } from "@thinkrail/locales/react";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";
import { layoutTabName, toolTab } from "@/shell/layout/model";
import type { WorkspaceLayoutDocument } from "@/shell/layout/types";
import { SideGroupMenu } from "@/shell/layout/workbenchSide";

const FILES = toolTab("files");

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
		groups: [{ id: "right", weight: 1, folded: false, tabs: [toolTab("specs"), FILES] }],
	},
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

export default function ToolPane() {
	const t = useT();
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const group = DOCUMENT.right.groups[0];
	return (
		<DndContext sensors={sensors}>
			<div className="w-full">
				<AuxiliaryPaneHeader
					title={layoutTabName(t, FILES)}
					dragTab={FILES}
					actions={
						<>
							{group ? (
								<SideGroupMenu
									document={DOCUMENT}
									side="right"
									group={group}
									limit={6}
									onNewTerminal={() => {}}
									onRevealTool={() => {}}
								/>
							) : null}
							<AuxiliaryPaneHideButton
								testId="side-group-fold"
								controls="example-files-pane"
								onClick={() => {}}
							/>
						</>
					}
				/>
			</div>
		</DndContext>
	);
}
