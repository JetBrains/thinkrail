import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store";
import { AnalyticsSharingSwitch } from "./AnalyticsPreferences";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

export function AnalyticsConsentDialog() {
	const [draft, setDraft] = useState(() => useAppStore.getState().analyticsEnabled);
	const { pending, error, save } = useAnalyticsConsent();

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) save(false);
			}}
		>
			<DialogContent data-testid="analytics-consent-dialog">
				<DialogHeader>
					<DialogTitle>Help improve ThinkRail</DialogTitle>
					<DialogDescription>
						Only anonymous feature usage and run outcomes are shared. No personal data, prompts,
						code, or file paths.
					</DialogDescription>
				</DialogHeader>
				<AnalyticsSharingSwitch enabled={draft} disabled={pending} onChange={setDraft} />
				<p className="tr-text-metadata text-text-muted">Change this later in Settings → Privacy.</p>
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
						{pending ? "Saving…" : "Save choice"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
