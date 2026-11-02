import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";

const CANDIDATES = [
	{ id: "markdown", labelKey: "viewer.renderer.preview" },
	{ id: "code", labelKey: "viewer.renderer.source" },
] as const;

export default function RendererCandidates() {
	const t = useT();
	const [rendererId, setRendererId] = useState<string>("markdown");
	const [layout, setLayout] = useState<"split" | "unified">("split");
	return (
		<span className="flex shrink-0 items-center gap-4">
			{CANDIDATES.map((candidate) => (
				<ToggleSegment
					key={candidate.id}
					testid={`renderer-${candidate.id}`}
					label={t(candidate.labelKey)}
					active={candidate.id === rendererId}
					onClick={() => setRendererId(candidate.id)}
				/>
			))}
			<ToggleSegment
				testid="diff-toggle-split"
				label={t("panels.diffPane.split")}
				active={layout === "split"}
				onClick={() => setLayout("split")}
			/>
			<ToggleSegment
				testid="diff-toggle-inline"
				label={t("panels.diffPane.inline")}
				active={layout === "unified"}
				onClick={() => setLayout("unified")}
			/>
		</span>
	);
}
