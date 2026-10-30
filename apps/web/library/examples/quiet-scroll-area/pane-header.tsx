import { useT } from "@thinkrail/locales/react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { TreeRow } from "@/panels/TreeRow";
import { AuxiliaryPaneHeader } from "@/shell/layout/AuxiliaryPaneHeader";

const SPECS = Array.from({ length: 18 }, (_, index) => `module-${index + 1}/SPEC.md`);

export default function PaneHeader() {
	const t = useT();
	return (
		<section
			aria-label={t("workbench.tool.specs")}
			className="flex h-240 w-full max-w-[20rem] flex-col bg-container-sidebar-bg"
		>
			<AuxiliaryPaneHeader title={t("workbench.tool.specs")} />
			<QuietScrollArea className="min-h-0 flex-1" viewportClassName="p-panel-inset">
				<ul className="flex flex-col">
					{SPECS.map((name) => (
						<li key={name}>
							<TreeRow testid="spec-node" kind="file" label={name} onClick={() => {}} />
						</li>
					))}
				</ul>
			</QuietScrollArea>
		</section>
	);
}
