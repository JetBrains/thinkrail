import { Button } from "@thinkrail/ui/button";
import type { ReactNode } from "react";

export function ExpensiveDiffNotice({
	onShowAnyway,
	actions,
}: {
	onShowAnyway: () => void;
	actions?: ReactNode;
}) {
	return (
		<div data-testid="diff-too-large" className="flex flex-col items-start gap-8 px-12 py-8">
			<p className="tr-text-ui text-text-muted">
				This diff is too expensive to show automatically. Rendering it can freeze the app for a
				while.
			</p>
			<div className="flex gap-8">
				<Button size="sm" variant="outline" data-testid="diff-show-anyway" onClick={onShowAnyway}>
					Show diff anyway
				</Button>
				{actions}
			</div>
		</div>
	);
}
