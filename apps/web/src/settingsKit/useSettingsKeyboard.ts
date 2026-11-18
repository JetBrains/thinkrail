import { type LocalKeyEvent, type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import type { FocusEvent, KeyboardEvent } from "react";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
import { walkAction, walkKey } from "./settingsKeys";
import { SETTING_ATTR } from "./settingsMarkup";
import {
	performWalk,
	rowIdOf,
	sideOf,
	textEntryKind,
	type WalkElement,
	type WalkExits,
} from "./settingsWalk";

export interface SettingsKeyboardOptions extends WalkExits {
	readonly onRowFocus?: ((rowId: string) => void) | undefined;
}

export interface SettingsKeyboardHandlers {
	readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

export interface SettingsKeyPress {
	readonly defaultPrevented: boolean;
	readonly nativeEvent: LocalKeyEvent;
}

export function settingsKeyDown<E extends WalkElement<E>>(
	event: SettingsKeyPress,
	root: E,
	target: E,
	keys: LocalKeys,
	exits: WalkExits,
): boolean {
	if (event.defaultPrevented || !root.contains(target)) return false;
	const press = event.nativeEvent;
	const entry = textEntryKind(target);
	const local = keys.match(press, { textEntry: entry !== null });
	const resetsWhileClean =
		entry !== null &&
		target.hasAttribute(SETTING_ATTR.clean) &&
		keys.match(press, { textEntry: false }) === "settings.reset";
	const action = walkAction(walkKey(press, resetsWhileClean ? "settings.reset" : local), {
		textEntry: entry !== null,
		multiline: entry === "multi",
		onSide: sideOf(target) !== null,
	});
	return action !== null && performWalk(root, target, action, exits);
}

export function useSettingsKeyboard({
	toNav,
	toResults,
	onRowFocus,
}: SettingsKeyboardOptions): SettingsKeyboardHandlers {
	const keys = useLocalKeys("settings", LOCAL_KEY_DEFAULTS.settings);
	return {
		onKeyDown: (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (settingsKeyDown(event, event.currentTarget, target, keys, { toNav, toResults })) {
				event.preventDefault();
			}
		},
		onFocus: (event) => {
			const rowId = rowIdOf(event.target);
			if (rowId !== null) onRowFocus?.(rowId);
		},
	};
}
