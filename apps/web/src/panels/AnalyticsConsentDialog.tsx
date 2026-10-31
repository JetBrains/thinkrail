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
import { AnalyticsConsentChoice } from "./AnalyticsPreferences";
import { useConsentDraft } from "./useAnalyticsConsent";

export function AnalyticsConsentDialog() {
	const t = useT();
	const { draft, toggle, pending, error, confirm } = useConsentDraft();

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) void confirm();
			}}
		>
			<DialogContent data-testid="analytics-consent-dialog" className="max-w-[30rem] gap-16">
				<DialogHeader>
					<DialogTitle>{t("panels.analyticsConsent.title")}</DialogTitle>
					<DialogDescription>{t("panels.analyticsConsent.subtitle")}</DialogDescription>
				</DialogHeader>
				<AnalyticsConsentChoice enabled={draft} disabled={pending} onChange={toggle} />
				{error && (
					<p role="alert" className="tr-text-metadata text-feedback-error">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button
						disabled={pending}
						data-testid="analytics-consent-confirm"
						onClick={() => void confirm()}
					>
						{pending ? t("panels.analyticsConsent.saving") : t("common.done")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
