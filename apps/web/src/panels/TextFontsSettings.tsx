import { useT } from "@thinkrail/locales/react";
import { useAppStore } from "@/store";
import { supportsFonts } from "@/transport";
import { CustomFontsGroup } from "./CustomFontsSettings";
import { FontsGroup } from "./FontsSettings";
import { LineWidthControl } from "./LineWidthSettings";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";

export function TextFontsSettings() {
	const t = useT();
	const fontsSupported = useAppStore((state) => supportsFonts(state.protocolVersion));
	return (
		<SettingsPageContainer testId="settings-text">
			{fontsSupported ? <FontsGroup /> : null}
			<SettingsGroup title={t("settings.lineWidth.label")}>
				<LineWidthControl kind="chat" />
				<LineWidthControl kind="file" />
			</SettingsGroup>
			{fontsSupported ? <CustomFontsGroup /> : null}
		</SettingsPageContainer>
	);
}
