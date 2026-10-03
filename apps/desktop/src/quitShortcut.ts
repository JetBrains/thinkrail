import { createQuitConfirmation, type QuitConfirmationDependencies } from "@thinkrail/contracts";
import type { KeyState } from "./keyState";

export interface QuitShortcutDependencies extends Omit<QuitConfirmationDependencies, "readHeld"> {
	readKeys(): KeyState | null;
}

function chordHeld(keys: KeyState) {
	return keys.keyDown && keys.cmdDown;
}

export function createQuitShortcut({ readKeys, ...dependencies }: QuitShortcutDependencies) {
	const confirmation = createQuitConfirmation({
		...dependencies,
		readHeld: () => {
			const keys = readKeys();
			return keys ? chordHeld(keys) : null;
		},
	});

	function press() {
		const keys = readKeys();
		if (!keys || (!keys.keyDown && !keys.cmdDown && keys.mouseAfterKey)) confirmation.quitNow();
		else confirmation.press(chordHeld(keys));
	}

	return { press };
}
