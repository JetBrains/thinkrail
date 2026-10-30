import { button } from "../content/components/button";
import { iconButton } from "../content/components/icon-button";
import { buttonShowcase } from "./button";
import { headerIconButtonShowcase } from "./header-icon-button";
import { tabStripShowcase } from "./tab-strip";
import type { Showcase } from "./types";

export const showcases: Readonly<Record<string, Showcase>> = {
	button: buttonShowcase("button", button),
	"icon-button": buttonShowcase("icon-button", iconButton),
	"header-icon-button": headerIconButtonShowcase,
	"tab-strip": tabStripShowcase,
};

export type { PlaygroundConfig, PlaygroundControl, PlaygroundValues, Showcase } from "./types";
