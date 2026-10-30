import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";

type Contrast = "normal" | "high";

export default function Pending() {
	const t = useT();
	const [contrast, setContrast] = useState<Contrast>("normal");
	const [pending, setPending] = useState(false);
	const select = (next: Contrast) => {
		if (next === contrast) return;
		setPending(true);
		setTimeout(() => {
			setContrast(next);
			setPending(false);
		}, 1200);
	};
	return (
		<SegmentedControl
			name="contrast-level"
			label={t("settings.appearance.contrastLevel")}
			options={[
				{ id: "normal", label: t("common.default"), testId: "contrast-default" },
				{ id: "high", label: t("settings.appearance.contrast.high"), testId: "contrast-high" },
			]}
			value={contrast}
			disabled={pending}
			onSelect={select}
			testId="contrast-level-control"
		/>
	);
}
