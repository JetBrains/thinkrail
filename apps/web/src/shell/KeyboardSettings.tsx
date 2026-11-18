import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { useClientPreferenceReset } from "../panels/settingDefaults";
import { SETTING, settingProps } from "../panels/settingsCatalog";
import type { SettingsSearchEntry } from "../panels/settingsSearch";
import { SettingsGroup, SettingsPage, SettingsRow } from "../settingsKit";
import { useAppStore } from "../store";
import { areaTitle, EXTENSION_AREAS, KeybindingEditor } from "./KeybindingEditor";
import { keybindingAreas, shortcutSearchEntries } from "./keybindingAreas";
import { entryTitle, useKeybindingLabel, useKeybindingList } from "./keybindingState";

export function useShortcutSearchEntries(desktop: boolean): SettingsSearchEntry[] {
	const t = useT();
	const list = useKeybindingList(desktop);
	return shortcutSearchEntries(keybindingAreas(list, EXTENSION_AREAS), {
		title: (entry) => entryTitle(t, entry),
		area: (area) => areaTitle(t, area),
		unbound: t("settings.keyboard.editor.unbound"),
	});
}

export function KeyboardSettings() {
	const t = useT();
	const openShortcut = useKeybindingLabel("search.open");
	const doubleShift = useAppStore((state) => state.doubleShiftSearch);
	const doubleShiftReset = useClientPreferenceReset("doubleShiftSearch");
	return (
		<SettingsPage
			testId="settings-keyboard"
			title={t("settings.nav.keyboard")}
			description={
				openShortcut
					? t("settings.keyboard.intro", { shortcut: openShortcut })
					: t("settings.keyboard.introUnbound")
			}
		>
			<SettingsGroup key="search" title={t("settings.keyboard.search")} scope="device">
				<SettingsRow
					{...settingProps(t, SETTING.doubleShift)}
					control={
						<Switch
							checked={doubleShift}
							label={t("settings.keyboard.doubleShift")}
							testId="settings-double-shift"
							tabIndex={0}
							onCheckedChange={(checked) => useAppStore.getState().setDoubleShiftSearch(checked)}
						/>
					}
					reset={doubleShiftReset}
				/>
			</SettingsGroup>
			<SettingsGroup
				key="shortcuts"
				title={t("settings.keyboard.shortcuts")}
				description={t("settings.keyboard.editor.intro")}
			>
				<KeybindingEditor />
			</SettingsGroup>
		</SettingsPage>
	);
}
