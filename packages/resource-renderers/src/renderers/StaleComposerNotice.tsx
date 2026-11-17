import { useT } from "@thinkrail/locales/react";
import { InlineNotice } from "@thinkrail/ui/inline-notice";

export function StaleComposerNotice({ visible }: { visible: boolean }) {
	const t = useT();
	return visible ? (
		<InlineNotice variant="warning" compact testId="review-selection-stale">
			{t("viewer.composer.fileChanged")}
		</InlineNotice>
	) : null;
}
