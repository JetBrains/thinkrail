import { useLocalKeys } from "@thinkrail/ui/local-keys";
import type { FocusEvent, KeyboardEvent } from "react";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
import { walkAction, walkKey } from "./settingsKeys";
import { SETTING_ATTR } from "./settingsMarkup";
import { performWalk, rowIdOf, sideOf, textEntryKind, type WalkExits } from "./settingsWalk";

export interface SettingsKeyboardOptions extends WalkExits {
	readonly onRowFocus?: ((rowId: string) => void) | undefined;
}

export interface SettingsKeyboardHandlers {
	readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

export function useSettingsKeyboard({
	toNav,
	toResults,
	onRowFocus,
}: SettingsKeyboardOptions): SettingsKeyboardHandlers {
	const keys = useLocalKeys("settings", LOCAL_KEY_DEFAULTS.settings);
	return {
		onKeyDown: (event) => {
			if (event.defaultPrevented) return;
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const entry = textEntryKind(target);
			const local = keys.match(event.nativeEvent, { textEntry: entry !== null });
			const resetsWhileClean =
				entry !== null &&
				target.hasAttribute(SETTING_ATTR.clean) &&
				keys.match(event.nativeEvent, { textEntry: false }) === "settings.reset";
			const press = event.nativeEvent;
			const action = walkAction(walkKey(press, resetsWhileClean ? "settings.reset" : local), {
				textEntry: entry !== null,
				multiline: entry === "multi",
				onSide: sideOf(target) !== null,
			});
			if (action && performWalk(event.currentTarget, target, action, { toNav, toResults })) {
				event.preventDefault();
			}
		},
		onFocus: (event) => {
			const rowId = rowIdOf(event.target);
			if (rowId !== null) onRowFocus?.(rowId);
		},
	};
}
