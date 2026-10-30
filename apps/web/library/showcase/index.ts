import { button } from "../content/components/button";
import { iconButton } from "../content/components/icon-button";
import { buttonShowcase } from "./button";
import type { Showcase } from "./types";

export const showcases: Readonly<Record<string, Showcase>> = {
	button: buttonShowcase("button", button),
	"icon-button": buttonShowcase("icon-button", iconButton),
};

export type { PlaygroundConfig, PlaygroundControl, PlaygroundValues, Showcase } from "./types";
