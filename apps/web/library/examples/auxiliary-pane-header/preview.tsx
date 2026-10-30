import { useT } from "@thinkrail/locales/react";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";

export default function Preview() {
	const t = useT();
	return (
		<section
			id="preview-projects-pane"
			aria-label={t("shell.projectHome.projects")}
			className="w-full"
		>
			<AuxiliaryPaneHeader
				title={t("shell.projectHome.projects")}
				actions={
					<AuxiliaryPaneHideButton
						testId="side-group-fold"
						controls="preview-projects-pane"
						onClick={() => {}}
					/>
				}
			/>
		</section>
	);
}
