import { useT } from "@thinkrail/locales/react";
import { useAppStore } from "@/store";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";

export function ArtifactsSettings() {
	const t = useT();
	const smart = useAppStore((s) => s.artifactsSmart);
	return (
		<div data-testid="settings-artifacts" className={SETTINGS_ROWS_CONTAINER}>
			<SettingsRow
				label={t("settings.artifacts.smart")}
				description={t("settings.artifacts.smartHint")}
				control={
					<SettingsSwitch
						checked={smart}
						label={t("settings.artifacts.smart")}
						testId="artifacts-smart-toggle"
						onChange={(next) => useAppStore.getState().setArtifactsSmart(next)}
					/>
				}
			/>
		</div>
	);
}
