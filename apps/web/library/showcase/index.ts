import { button } from "../content/components/button";
import { iconButton } from "../content/components/icon-button";
import { attentionDotShowcase } from "./attention-dot";
import { attentionLineShowcase } from "./attention-line";
import { buttonShowcase } from "./button";
import { collapsibleShowcase } from "./collapsible";
import { diffStatBadgeShowcase } from "./diff-stat-badge";
import { errorBoundaryShowcase } from "./error-boundary";
import { fileChipShowcase } from "./file-chip";
import { headerIconButtonShowcase } from "./header-icon-button";
import { runningIconShowcase } from "./running-icon";
import { segmentedControlShowcase } from "./segmented-control";
import { settingsNoticeShowcase } from "./settings-notice";
import { settingsRadioCardsShowcase } from "./settings-radio-cards";
import { settingsRowShowcase } from "./settings-row";
import { settingsSwitchShowcase } from "./settings-switch";
import { skeletonShowcase } from "./skeleton";
import { staleComposerNoticeShowcase } from "./stale-composer-notice";
import { switchShowcase } from "./switch";
import { tabStripShowcase } from "./tab-strip";
import { textareaShowcase } from "./textarea";
import { toastShowcase } from "./toast";
import { toggleSegmentShowcase } from "./toggle-segment";
import { treeRowShowcase } from "./tree-row";
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
	"diff-stat-badge": diffStatBadgeShowcase,
	"file-chip": fileChipShowcase,
	collapsible: collapsibleShowcase,
	"tree-row": treeRowShowcase,
	"tab-strip": tabStripShowcase,
	skeleton: skeletonShowcase,
	"stale-composer-notice": staleComposerNoticeShowcase,
	"settings-notice": settingsNoticeShowcase,
	toast: toastShowcase,
	"error-boundary": errorBoundaryShowcase,
	"running-icon": runningIconShowcase,
	"attention-dot": attentionDotShowcase,
	"attention-line": attentionLineShowcase,
};

export type { PlaygroundConfig, PlaygroundControl, PlaygroundValues, Showcase } from "./types";
