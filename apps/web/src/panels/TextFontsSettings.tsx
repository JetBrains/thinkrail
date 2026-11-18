import { useT } from "@thinkrail/locales/react";
import { SettingsPage } from "@/settingsKit";
import { useAppStore } from "@/store";
import { supportsFonts } from "@/transport";
import { CustomFontsGroup } from "./CustomFontsSettings";
import { CodeFontsGroup, InterfaceFontsGroup } from "./FontsSettings";
import { LineWidthGroup } from "./LineWidthSettings";

export function TextFontsSettings() {
	const t = useT();
	const fontsSupported = useAppStore((state) => supportsFonts(state.protocolVersion));
	return (
		<SettingsPage
			title={t("settings.nav.text")}
			description={t("settings.text.description")}
			testId="settings-text"
		>
			{fontsSupported ? <InterfaceFontsGroup /> : null}
			{fontsSupported ? <CodeFontsGroup /> : null}
			<LineWidthGroup />
			{fontsSupported ? <CustomFontsGroup /> : null}
		</SettingsPage>
	);
}
