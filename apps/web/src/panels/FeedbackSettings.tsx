import { RiDiscordLine as Discord, RiMailLine as Mail } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, buttonVariants } from "@thinkrail/ui/button";
import { SETTINGS_ROWS, SettingsPage, SettingsRow } from "@/settingsKit";
import { useAppStore } from "@/store";
import { SETTING, settingProps } from "./settingsCatalog";

const DISCORD_URL = "https://thinkrail.ai/discord";
const FEEDBACK_EMAIL = "info@thinkrail.ai";
const LINK_BUTTON = buttonVariants({ variant: "outline", size: "m" });

export function FeedbackSettings() {
	const surveyAvailable = useAppStore((state) => state.inAppSurvey !== null);
	return <FeedbackSettingsView surveyAvailable={surveyAvailable} />;
}

export function FeedbackSettingsView({ surveyAvailable }: { surveyAvailable: boolean }) {
	const t = useT();
	return (
		<SettingsPage
			title={t("settings.dialog.feedbackCta")}
			description={t("settings.feedback.description")}
			testId="settings-feedback"
		>
			<div className={SETTINGS_ROWS}>
				{surveyAvailable ? (
					<SettingsRow
						{...settingProps(t, SETTING.survey)}
						control={
							<Button
								variant="primary"
								size="m"
								tabIndex={0}
								data-testid="feedback-take-survey"
								onClick={() => useAppStore.getState().openSurveyWindow()}
							>
								{t("settings.feedback.takeSurvey")}
							</Button>
						}
					/>
				) : null}
				<SettingsRow
					{...settingProps(t, SETTING.discord)}
					control={
						<a
							data-testid="feedback-join-discord"
							href={DISCORD_URL}
							target="_blank"
							rel="noopener noreferrer"
							tabIndex={0}
							className={LINK_BUTTON}
						>
							<Discord aria-hidden />
							{t("settings.feedback.join")}
						</a>
					}
				/>
				<SettingsRow
					{...settingProps(t, SETTING.feedbackEmail)}
					testId="feedback-email"
					control={
						<a href={`mailto:${FEEDBACK_EMAIL}`} tabIndex={0} className={LINK_BUTTON}>
							<Mail aria-hidden />
							{FEEDBACK_EMAIL}
						</a>
					}
				/>
			</div>
		</SettingsPage>
	);
}
