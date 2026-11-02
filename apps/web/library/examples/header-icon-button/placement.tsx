import { RiCollapseVerticalLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";

export default function Placement() {
	const t = useT();
	const [mode, setMode] = useState<"all" | "changed">("all");
	return (
		<div
			role="toolbar"
			aria-label={t("panels.files.toolbar")}
			className="flex w-full max-w-[20rem] items-center gap-4"
		>
			<ToggleSegment
				testid="files-mode-all"
				label={t("panels.files.all")}
				active={mode === "all"}
				onClick={() => setMode("all")}
			/>
			<ToggleSegment
				testid="files-mode-changed"
				label={t("panels.files.changed")}
				active={mode === "changed"}
				onClick={() => setMode("changed")}
			/>
			<div className="ml-auto flex shrink-0">
				<HeaderIconButton
					testid="files-collapse-all"
					label={t("panels.files.collapseAll")}
					onClick={() => {}}
					icon={RiCollapseVerticalLine}
				/>
			</div>
		</div>
	);
}
