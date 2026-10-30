import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";
import { AuxiliaryRail, AuxiliaryRailToolButton } from "@/shell/layout/AuxiliaryRail";
import type { AuxiliaryRailToolEntry } from "@/shell/layout/auxiliaryPresentation";

const PANE_ID = "example-projects-pane";

export default function ProjectHome() {
	const t = useT();
	const [collapsed, setCollapsed] = useState(false);
	const toggle = () => setCollapsed((value) => !value);
	const entry: AuxiliaryRailToolEntry = {
		key: "projects",
		region: "left",
		kind: "tool",
		groupId: null,
		tool: "projects",
		tab: null,
		selected: true,
		expanded: !collapsed,
	};
	return (
		<div className="flex h-[8rem] w-full">
			<AuxiliaryRail
				region="left"
				entries={[entry]}
				renderEntry={(_, control) => (
					<AuxiliaryRailToolButton
						entry={entry}
						controls={PANE_ID}
						control={control}
						onActivate={toggle}
					/>
				)}
			/>
			<section
				id={PANE_ID}
				aria-label={t("shell.projectHome.projects")}
				hidden={collapsed}
				className="flex min-w-0 flex-1 flex-col"
			>
				<AuxiliaryPaneHeader
					title={t("shell.projectHome.projects")}
					actions={
						<AuxiliaryPaneHideButton testId="side-group-fold" controls={PANE_ID} onClick={toggle} />
					}
				/>
			</section>
		</div>
	);
}
