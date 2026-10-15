import { RiAlertLine } from "@remixicon/react";
import { FILE_CHANGED_NOTICE } from "./reviewComposerState";

export function StaleComposerNotice({ visible }: { visible: boolean }) {
	return visible ? (
		<p
			role="status"
			data-testid="review-selection-stale"
			className="flex items-center gap-8 rounded-sm border border-feedback-warning-muted bg-container-elevated-bg px-8 py-4 tr-text-metadata text-text-default"
		>
			<RiAlertLine className="size-14 shrink-0 text-feedback-warning" aria-hidden />
			{FILE_CHANGED_NOTICE}
		</p>
	) : null;
}
