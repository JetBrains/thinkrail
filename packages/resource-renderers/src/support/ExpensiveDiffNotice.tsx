import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import type { ReactNode } from "react";

export function ExpensiveDiffNotice({
	onShowAnyway,
	actions,
}: {
	onShowAnyway: () => void;
	actions?: ReactNode;
}) {
	const t = useT();
	return (
		<div data-testid="diff-too-large" className="flex flex-col items-start gap-8 px-12 py-8">
			<p className="tr-text-ui text-text-muted">{t("panels.diffSurface.tooExpensive")}</p>
			<div className="flex gap-8">
				<Button size="m" variant="outline" data-testid="diff-show-anyway" onClick={onShowAnyway}>
					{t("panels.diffSurface.showAnyway")}
				</Button>
				{actions}
			</div>
		</div>
	);
}
