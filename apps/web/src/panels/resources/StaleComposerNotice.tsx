import { FILE_CHANGED_NOTICE } from "./reviewComposerState";

export function StaleComposerNotice({ visible }: { visible: boolean }) {
	return visible ? (
		<p
			role="status"
			data-testid="review-selection-stale"
			className="border border-feedback-warning bg-feedback-warning-subtle px-8 py-4 tr-text-metadata text-feedback-warning"
		>
			{FILE_CHANGED_NOTICE}
		</p>
	) : null;
}
