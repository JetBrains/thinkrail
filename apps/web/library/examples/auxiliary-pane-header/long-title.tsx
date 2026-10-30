import { useT } from "@thinkrail/locales/react";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";
import { layoutTabName, toolTab } from "@/shell/layout/model";

export default function LongTitle() {
	const t = useT();
	return (
		<div className="flex w-full flex-col gap-8">
			<div className="w-[12rem]">
				<AuxiliaryPaneHeader
					title={layoutTabName(t, toolTab("plan"))}
					actions={
						<AuxiliaryPaneHideButton
							testId="side-group-fold"
							controls="example-plan-pane"
							onClick={() => {}}
						/>
					}
				/>
			</div>
			<div className="w-[5rem]">
				<AuxiliaryPaneHeader
					title={layoutTabName(t, toolTab("plan"))}
					actions={
						<AuxiliaryPaneHideButton
							testId="side-group-fold"
							controls="example-plan-pane"
							onClick={() => {}}
						/>
					}
				/>
			</div>
		</div>
	);
}
