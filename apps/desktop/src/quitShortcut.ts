import { createQuitConfirmation, type QuitConfirmationDependencies } from "@thinkrail/contracts";
import type { KeyState } from "./keyState";

export interface QuitShortcutDependencies extends Omit<QuitConfirmationDependencies, "readHeld"> {
	readKeys(): KeyState | null;
}

export function createQuitShortcut({ readKeys, ...dependencies }: QuitShortcutDependencies) {
	let pressKeys: number[] = [];

	function chordHeld(keys: KeyState) {
		return keys.cmdDown && pressKeys.some((keycode) => keys.downKeys.includes(keycode));
	}

	const confirmation = createQuitConfirmation({
		...dependencies,
		readHeld: () => {
			const keys = readKeys();
			return keys ? chordHeld(keys) : null;
		},
	});

	function snapshot(keys: KeyState) {
		const stillDown = pressKeys.filter((keycode) => keys.downKeys.includes(keycode));
		pressKeys = stillDown.length > 0 ? stillDown : keys.downKeys;
	}

	function press() {
		const keys = readKeys();
		if (!keys || (!keys.keyDown && !keys.cmdDown && keys.mouseAfterKey)) {
			confirmation.quitNow();
			return;
		}
		snapshot(keys);
		confirmation.press(chordHeld(keys));
	}

	return { press };
}
