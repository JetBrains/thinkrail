import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";

export default function ListTree() {
	const t = useT();
	const [view, setView] = useState<"list" | "tree">("list");
	return (
		<div role="toolbar" aria-label={t("changes.panel.toolbar")} className="flex items-center gap-4">
			<ToggleSegment
				testid="changes-toggle-list"
				label={t("changes.panel.list")}
				active={view === "list"}
				onClick={() => setView("list")}
			/>
			<ToggleSegment
				testid="changes-toggle-tree"
				label={t("changes.panel.tree")}
				active={view === "tree"}
				onClick={() => setView("tree")}
			/>
		</div>
	);
}
