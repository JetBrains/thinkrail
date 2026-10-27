import { RiDiscordLine as Discord, RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { buttonVariants } from "@thinkrail/ui/button";
import { INTERVIEW_BOOKING_URL, INTERVIEW_INVITATION_KEY } from "./interview";

const DISCORD_URL = "https://thinkrail.ai/discord";

export function FeedbackSettings() {
	const t = useT();
	return (
		<section data-testid="settings-feedback" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">{t("settings.feedback.title")}</h3>
				<p className="text-text-muted tr-text-metadata">{t(INTERVIEW_INVITATION_KEY)}</p>
			</div>
			<a
				data-testid="feedback-schedule-interview"
				href={INTERVIEW_BOOKING_URL}
				target="_blank"
				rel="noopener noreferrer"
				className={buttonVariants({ variant: "primary", size: "l", className: "self-start" })}
			>
				<ExternalLink aria-hidden />
				{t("settings.feedback.scheduleInterview")}
			</a>
			<p className="text-text-muted tr-text-metadata">
				{t("settings.feedback.discordDescription")}
			</p>
			<a
				data-testid="feedback-join-discord"
				href={DISCORD_URL}
				target="_blank"
				rel="noopener noreferrer"
				className={buttonVariants({ variant: "outline", size: "l", className: "self-start" })}
			>
				<Discord aria-hidden />
				{t("settings.feedback.joinDiscord")}
			</a>
		</section>
	);
}
