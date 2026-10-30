import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useT } from "@thinkrail/locales/react";
import type { ReactNode } from "react";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";
import { layoutTabName, toolTab } from "@/shell/layout/model";
import { Table } from "../parts/Section";
import type { Showcase } from "./types";

function Cell({ children }: { children: ReactNode }) {
	return <div className="w-full min-w-[12rem]">{children}</div>;
}

function Hide() {
	return (
		<AuxiliaryPaneHideButton testId="side-group-fold" controls="showcase-pane" onClick={() => {}} />
	);
}

function StateMatrix() {
	const t = useT();
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const files = toolTab("files");
	return (
		<DndContext sensors={sensors}>
			<Table
				head={["Title", "Live"]}
				rows={[
					[
						"Plain",
						<Cell key="live">
							<AuxiliaryPaneHeader title={t("shell.projectHome.projects")} actions={<Hide />} />
						</Cell>,
					],
					[
						"Drag handle",
						<Cell key="live">
							<AuxiliaryPaneHeader
								title={layoutTabName(t, files)}
								dragTab={files}
								actions={<Hide />}
							/>
						</Cell>,
					],
					[
						"No actions",
						<Cell key="live">
							<AuxiliaryPaneHeader title={t("workbench.pane.tools")} />
						</Cell>,
					],
					[
						"Clipped (no ellipsis)",
						<div key="live" className="w-[5rem]">
							<AuxiliaryPaneHeader title={layoutTabName(t, toolTab("plan"))} actions={<Hide />} />
						</div>,
					],
				]}
			/>
		</DndContext>
	);
}

export const auxiliaryPaneHeaderShowcase: Showcase = {
	sections: [{ id: "states", Render: StateMatrix }],
};
