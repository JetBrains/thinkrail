import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { SettingsGroup } from "@/panels/SettingsGroup";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

type ThemeMode = "system" | "light" | "dark";

export default function Preview() {
	const t = useT();
	const [mode, setMode] = useState<ThemeMode>("system");
	const [autoFix, setAutoFix] = useState(true);
	return (
		<div className="w-full max-w-[28rem]">
			<SettingsGroup title={t("settings.appearance.themeGroup")}>
				<SettingsRow
					label={t("settings.appearance.themeMode")}
					control={
						<SegmentedControl
							name="preview-theme-mode"
							label={t("settings.appearance.themeMode")}
							options={[
								{ id: "system", label: t("settings.appearance.mode.system") },
								{ id: "light", label: t("settings.appearance.mode.light") },
								{ id: "dark", label: t("settings.appearance.mode.dark") },
							]}
							value={mode}
							onSelect={setMode}
						/>
					}
				/>
				<SettingsRow
					label={t("settings.models.autoFix")}
					description={t("settings.models.autoFixDescription")}
					control={
						<SettingsSwitch
							checked={autoFix}
							label={t("settings.models.autoFix")}
							testId="preview-autofix-toggle"
							onChange={setAutoFix}
						/>
					}
				/>
			</SettingsGroup>
		</div>
	);
}
