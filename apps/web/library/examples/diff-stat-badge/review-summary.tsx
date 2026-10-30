import { useT } from "@thinkrail/locales/react";
import { DiffStatBadge } from "@/panels/DiffStatBadge";

export default function ReviewSummary() {
	const t = useT();
	return (
		<span className="flex min-w-0 items-center gap-4 tr-text-metadata text-text-muted">
			<span>{t("changes.review.fileCount", { count: 7 })}</span>
			<DiffStatBadge added={214} removed={63} />
			<span>{t("changes.review.viewedCount", { viewed: 2, total: 7 })}</span>
		</span>
	);
}
