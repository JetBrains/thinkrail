import { COMPARISON_DESCRIPTION, Comparison, stateMatrix } from "./switch";
import type { Showcase } from "./types";

export const settingsSwitchShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Click the first row, or click into the page and press Tab to see keyboard focus; there is no hover treatment. Disabled is the real prop.",
			Render: stateMatrix("settings-switch"),
		},
		{
			id: "compare",
			title: "SettingsSwitch and Switch",
			description: COMPARISON_DESCRIPTION,
			Render: Comparison,
		},
	],
};
