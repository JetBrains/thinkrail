import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ANALYTICS_DESCRIPTION, AnalyticsSharingSwitch } from "./AnalyticsPreferences";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

export function AnalyticsConsentDialog() {
	const [draft, setDraft] = useState(true);
	const primed = useRef(false);
	const { pending, error, save, prime } = useAnalyticsConsent();

	useEffect(() => {
		if (primed.current) return;
		primed.current = true;
		prime();
	}, [prime]);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) save(draft);
			}}
		>
			<DialogContent data-testid="analytics-consent-dialog">
				<DialogHeader>
					<DialogTitle>Help improve ThinkRail</DialogTitle>
					<DialogDescription>{ANALYTICS_DESCRIPTION}</DialogDescription>
				</DialogHeader>
				<AnalyticsSharingSwitch
					enabled={draft}
					disabled={pending}
					onChange={(enabled) => {
						setDraft(enabled);
						if (!enabled) save(false);
					}}
				/>
				{error && (
					<p role="alert" className="tr-text-metadata text-feedback-error">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button
						disabled={pending}
						data-testid="analytics-consent-confirm"
						onClick={() => save(draft)}
					>
						{pending ? "Saving…" : "Done"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
