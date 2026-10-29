import { RiDiscordLine as Discord } from "@remixicon/react";
import { T, useT } from "@thinkrail/locales/react";
import { Button, buttonVariants } from "@thinkrail/ui/button";
import type { ReactNode } from "react";
import { useAppStore } from "@/store";

const DISCORD_URL = "https://thinkrail.ai/discord";
const FEEDBACK_EMAIL = "info@thinkrail.ai";

export function FeedbackSettings() {
	const surveyAvailable = useAppStore((state) => state.inAppSurvey !== null);
	return <FeedbackSettingsView surveyAvailable={surveyAvailable} />;
}

export function FeedbackSettingsView({ surveyAvailable }: { surveyAvailable: boolean }) {
	const t = useT();
	return (
		<section data-testid="settings-feedback" className="flex flex-col gap-16">
			<h3 className="tr-title-section text-text-default">{t("settings.feedback.title")}</h3>
			{surveyAvailable ? (
				<div className="flex flex-col items-start gap-8">
					<p className="text-text-muted tr-text-metadata">
						{t("settings.feedback.surveyDescription")}
					</p>
					<Button
						variant="primary"
						size="l"
						data-testid="feedback-take-survey"
						onClick={() => useAppStore.getState().openSurveyWindow()}
					>
						{t("settings.feedback.takeSurvey")}
					</Button>
				</div>
			) : null}
			<div className="flex flex-col items-start gap-8">
				<p className="text-text-muted tr-text-metadata">
					{t("settings.feedback.discordDescription")}
				</p>
				<a
					data-testid="feedback-join-discord"
					href={DISCORD_URL}
					target="_blank"
					rel="noopener noreferrer"
					className={buttonVariants({ variant: "outline", size: "l" })}
				>
					<Discord aria-hidden />
					{t("settings.feedback.joinDiscord")}
				</a>
			</div>
			<p data-testid="feedback-email" className="text-text-muted tr-text-metadata">
				<T
					i18nKey="settings.feedback.email"
					components={[<EmailLink key="email" />]}
					values={{ email: FEEDBACK_EMAIL }}
				/>
			</p>
		</section>
	);
}

function EmailLink({ children }: { children?: ReactNode }) {
	return (
		<a
			href={`mailto:${FEEDBACK_EMAIL}`}
			className="text-primary underline underline-offset-2 hover:opacity-80"
		>
			{children}
		</a>
	);
}
