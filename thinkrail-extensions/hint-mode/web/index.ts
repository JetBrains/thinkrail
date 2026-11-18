import { defineWebExtension } from "@thinkrail/extension-api/web";
import { HintMode } from "./HintMode";
import { HINT_KEYS, SHOW_HINTS } from "./keys";

export default defineWebExtension({
	name: "hint-mode",
	title: "hintMode.title",
	description: "hintMode.description",
	globalOverlay: HintMode,
	commands: [SHOW_HINTS],
	shortcuts: [
		{
			id: "hint-mode.focusOnly",
			title: "hintMode.shortcuts.focusOnly",
			keys: [HINT_KEYS.focusOnly],
		},
		{ id: "hint-mode.undo", title: "hintMode.shortcuts.undo", keys: [HINT_KEYS.undo] },
		{ id: "hint-mode.exit", title: "hintMode.shortcuts.exit", keys: [HINT_KEYS.exit] },
	],
});
