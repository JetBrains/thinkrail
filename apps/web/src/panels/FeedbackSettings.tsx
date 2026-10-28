import type { AppSurvey } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { useAppStore } from "@/store";
import { SurveyForm } from "./SurveyForm";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

export function FeedbackSettings() {
	const survey = useAppStore((state) => state.inAppSurvey);
	const analyticsEnabled = useAppStore((state) => state.analyticsEnabled);
	return <FeedbackSettingsView survey={survey} analyticsEnabled={analyticsEnabled} />;
}

export function FeedbackSettingsView({
	survey,
	analyticsEnabled,
}: {
	survey: AppSurvey | null;
	analyticsEnabled: boolean;
}) {
	const t = useT();
	const [thanks, setThanks] = useState<string | null>(null);
	const consent = useAnalyticsConsent();

	return (
		<section data-testid="settings-feedback" className="flex flex-col gap-16">
			{thanks !== null ? (
				<p data-testid="survey-thanks" className="tr-title-section text-text-default">
					{thanks}
				</p>
			) : survey && !analyticsEnabled ? (
				<div className="flex flex-col items-start gap-12">
					<p data-testid="survey-analytics-message" className="text-text-default tr-text-ui">
						{t("panels.survey.analyticsRequired")}
					</p>
					<Button
						variant="primary"
						data-testid="survey-enable-analytics"
						disabled={consent.pending}
						onClick={() => void consent.save(true)}
					>
						{t("panels.survey.enableAnalytics")}
					</Button>
					{consent.error ? (
						<p role="alert" className="tr-text-metadata text-feedback-error">
							{consent.error}
						</p>
					) : null}
				</div>
			) : survey ? (
				<SurveyForm
					key={`${survey.id}:${survey.iteration}`}
					survey={survey}
					onCompleted={(message) => {
						useAppStore.getState().setInAppSurvey(null);
						if (message !== null) setThanks(message);
					}}
				/>
			) : null}
		</section>
	);
}
