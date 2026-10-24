import { RiAlertLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";

export function StaleComposerNotice({ visible }: { visible: boolean }) {
	const t = useT();
	return visible ? (
		<p
			role="status"
			data-testid="review-selection-stale"
			className="flex items-center gap-8 rounded-sm border border-feedback-warning-muted bg-container-elevated-bg px-8 py-4 tr-text-metadata text-text-default"
		>
			<RiAlertLine className="size-14 shrink-0 text-feedback-warning" aria-hidden />
			{t("viewer.composer.fileChanged")}
		</p>
	) : null;
}
