import { button } from "../content/components/button";
import { iconButton } from "../content/components/icon-button";
import { attentionDotShowcase } from "./attention-dot";
import { attentionLineShowcase } from "./attention-line";
import { auxiliaryPaneHeaderShowcase } from "./auxiliary-pane-header";
import { buttonShowcase } from "./button";
import { collapsibleShowcase } from "./collapsible";
import { commandShowcase } from "./command";
import { confirmDialogShowcase } from "./confirm-dialog";
import { confirmPopoverShowcase } from "./confirm-popover";
import { contextMenuShowcase } from "./context-menu";
import { dialogShowcase } from "./dialog";
import { diffStatBadgeShowcase } from "./diff-stat-badge";
import { dropdownMenuShowcase } from "./dropdown-menu";
import { errorBoundaryShowcase } from "./error-boundary";
import { fileChipShowcase } from "./file-chip";
import { headerIconButtonShowcase } from "./header-icon-button";
import { popoverShowcase } from "./popover";
import { quietScrollAreaShowcase } from "./quiet-scroll-area";
import { resizableShowcase } from "./resizable";
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
import { tooltipShowcase } from "./tooltip";
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
	dialog: dialogShowcase,
	"confirm-dialog": confirmDialogShowcase,
	popover: popoverShowcase,
	"confirm-popover": confirmPopoverShowcase,
	tooltip: tooltipShowcase,
	"dropdown-menu": dropdownMenuShowcase,
	"context-menu": contextMenuShowcase,
	command: commandShowcase,
	resizable: resizableShowcase,
	"quiet-scroll-area": quietScrollAreaShowcase,
	"auxiliary-pane-header": auxiliaryPaneHeaderShowcase,
};

export type { PlaygroundConfig, PlaygroundControl, PlaygroundValues, Showcase } from "./types";
