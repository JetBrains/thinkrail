import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { SettingsGroup } from "@/panels/SettingsGroup";
import { SettingsRow } from "@/panels/SettingsRow";

type ThemeMode = "system" | "light" | "dark";
type Contrast = "normal" | "high";

export default function Pending() {
	const t = useT();
	const [mode, setMode] = useState<ThemeMode>("dark");
	const [contrast, setContrast] = useState<Contrast>("normal");
	const [pending, setPending] = useState(false);
	const save = (apply: () => void) => {
		setPending(true);
		setTimeout(() => {
			apply();
			setPending(false);
		}, 1200);
	};
	return (
		<div className="w-full max-w-[32rem]">
			<SettingsGroup title={t("settings.appearance.themeGroup")}>
				<SettingsRow
					label={t("settings.appearance.themeMode")}
					control={
						<SegmentedControl
							name="pending-theme-mode"
							label={t("settings.appearance.themeMode")}
							options={[
								{ id: "system", label: t("settings.appearance.mode.system") },
								{ id: "light", label: t("settings.appearance.mode.light") },
								{ id: "dark", label: t("settings.appearance.mode.dark") },
							]}
							value={mode}
							disabled={pending}
							onSelect={(next) => save(() => setMode(next))}
						/>
					}
				/>
				<SettingsRow
					label={t("settings.appearance.contrastLevel")}
					control={
						<SegmentedControl
							name="pending-contrast-level"
							label={t("settings.appearance.contrastLevel")}
							options={[
								{ id: "normal", label: t("common.default") },
								{ id: "high", label: t("settings.appearance.contrast.high") },
							]}
							value={contrast}
							disabled={pending}
							onSelect={(next) => save(() => setContrast(next))}
						/>
					}
				/>
			</SettingsGroup>
		</div>
	);
}
