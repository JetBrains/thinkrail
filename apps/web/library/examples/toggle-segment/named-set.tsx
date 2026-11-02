import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";

const VIEWPORTS = [
	{ id: "fill", labelKey: "viewer.html.viewport.fill" },
	{ id: "phone", labelKey: "viewer.html.viewport.phone" },
	{ id: "tablet", labelKey: "viewer.html.viewport.tablet" },
	{ id: "desktop", labelKey: "viewer.html.viewport.desktop" },
] as const;

export default function NamedSet() {
	const t = useT();
	const [viewport, setViewport] = useState<string>("fill");
	return (
		<fieldset aria-label={t("viewer.html.viewport.label")} className="m-0 flex gap-2 border-0 p-0">
			{VIEWPORTS.map((candidate) => (
				<ToggleSegment
					key={candidate.id}
					testid={`html-viewport-${candidate.id}`}
					label={t(candidate.labelKey)}
					active={candidate.id === viewport}
					onClick={() => setViewport(candidate.id)}
				/>
			))}
		</fieldset>
	);
}
