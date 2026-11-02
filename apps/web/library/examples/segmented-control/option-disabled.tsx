import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl, type SegmentedControlOption } from "@/panels/SegmentedControl";

type ThemeMode = "system" | "light" | "dark";

export default function OptionDisabled() {
	const t = useT();
	const [mode, setMode] = useState<ThemeMode>("light");
	const options: SegmentedControlOption<ThemeMode>[] = [
		{ id: "system", label: t("settings.appearance.mode.system"), testId: "theme-mode-system" },
		{ id: "light", label: t("settings.appearance.mode.light"), testId: "theme-mode-light" },
		{
			id: "dark",
			label: t("settings.appearance.mode.dark"),
			testId: "theme-mode-dark",
			disabled: true,
		},
	];
	return (
		<SegmentedControl
			name="theme-mode"
			label={t("settings.appearance.themeMode")}
			options={options}
			value={mode}
			onSelect={setMode}
			testId="theme-mode-control"
		/>
	);
}
