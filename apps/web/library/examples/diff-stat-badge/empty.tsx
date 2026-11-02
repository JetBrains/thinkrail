import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";
import { DiffStatBadge } from "@/panels/DiffStatBadge";

const SCOPES = {
	uncommitted: { files: 3, added: 48, removed: 9 },
	lastTurn: { files: 0, added: 0, removed: 0 },
} as const;

export default function Empty() {
	const t = useT();
	const [scope, setScope] = useState<keyof typeof SCOPES>("uncommitted");
	const totals = SCOPES[scope];
	return (
		<div className="flex flex-col items-start gap-8">
			<div className="flex gap-2">
				<ToggleSegment
					testid="scope-uncommitted"
					label={t("changes.scope.uncommitted")}
					active={scope === "uncommitted"}
					onClick={() => setScope("uncommitted")}
				/>
				<ToggleSegment
					testid="scope-last-turn"
					label={t("changes.scope.lastTurn")}
					active={scope === "lastTurn"}
					onClick={() => setScope("lastTurn")}
				/>
			</div>
			<span className="flex items-center gap-4 tr-text-metadata text-text-muted">
				<span>{t("changes.review.fileCount", { count: totals.files })}</span>
				<DiffStatBadge added={totals.added} removed={totals.removed} />
			</span>
		</div>
	);
}
