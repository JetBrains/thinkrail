import { Comparison, stateMatrix } from "./switch";
import type { Showcase } from "./types";

export const settingsSwitchShowcase: Showcase = {
	sections: [
		{ id: "states", Render: stateMatrix("settings-switch") },
		{ id: "compare", Render: Comparison },
	],
};
