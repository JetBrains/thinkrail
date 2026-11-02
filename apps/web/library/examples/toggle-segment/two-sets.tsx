import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";

export default function TwoSets() {
	const t = useT();
	const [view, setView] = useState<"split" | "inline">("split");
	const [layout, setLayout] = useState<"stacked" | "single">("stacked");
	return (
		<span className="flex items-center gap-4">
			<ToggleSegment
				testid="changes-review-toggle-split"
				label={t("changes.review.split")}
				active={view === "split"}
				onClick={() => setView("split")}
			/>
			<ToggleSegment
				testid="changes-review-toggle-inline"
				label={t("changes.review.inline")}
				active={view === "inline"}
				onClick={() => setView("inline")}
			/>
			<span className="mx-4 h-16 w-px bg-border-default" />
			<ToggleSegment
				testid="changes-review-layout-stacked"
				label={t("changes.review.stacked")}
				active={layout === "stacked"}
				onClick={() => setLayout("stacked")}
			/>
			<ToggleSegment
				testid="changes-review-layout-single"
				label={t("changes.review.oneFile")}
				active={layout === "single"}
				onClick={() => setLayout("single")}
			/>
		</span>
	);
}
