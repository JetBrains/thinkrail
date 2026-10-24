import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { AnalyticsDescription, AnalyticsSharingSwitch } from "./AnalyticsPreferences";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

export function AnalyticsConsentDialog() {
	const t = useT();
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
					<DialogTitle>{t("panels.analyticsConsent.title")}</DialogTitle>
					<DialogDescription>
						<AnalyticsDescription />
					</DialogDescription>
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
						{pending ? t("panels.analyticsConsent.saving") : t("common.done")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
