import { button } from "../content/components/button";
import { iconButton } from "../content/components/icon-button";
import { buttonShowcase } from "./button";
import { headerIconButtonShowcase } from "./header-icon-button";
import { segmentedControlShowcase } from "./segmented-control";
import { settingsRadioCardsShowcase } from "./settings-radio-cards";
import { settingsRowShowcase } from "./settings-row";
import { settingsSwitchShowcase } from "./settings-switch";
import { switchShowcase } from "./switch";
import { tabStripShowcase } from "./tab-strip";
import { textareaShowcase } from "./textarea";
import { toggleSegmentShowcase } from "./toggle-segment";
import type { Showcase } from "./types";

export const showcases: Readonly<Record<string, Showcase>> = {
	button: buttonShowcase("button", button),
	"icon-button": buttonShowcase("icon-button", iconButton),
	"header-icon-button": headerIconButtonShowcase,
	"settings-switch": settingsSwitchShowcase,
	switch: switchShowcase,
	"toggle-segment": toggleSegmentShowcase,
	"segmented-control": segmentedControlShowcase,
	textarea: textareaShowcase,
	"settings-radio-cards": settingsRadioCardsShowcase,
	"settings-row": settingsRowShowcase,
	"tab-strip": tabStripShowcase,
};

export type { PlaygroundConfig, PlaygroundControl, PlaygroundValues, Showcase } from "./types";
