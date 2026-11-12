import { RiQuestionnaireLine as MessageCircleQuestion } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";

export function AttentionLine({
	announced = false,
	live = true,
}: {
	announced?: boolean;
	live?: boolean;
}) {
	const t = useT();
	return (
		<div className="flex items-center gap-4 text-primary tr-text-action">
			<span aria-hidden={!live || announced || undefined} className="flex items-center gap-4">
				<MessageCircleQuestion className="size-14 shrink-0" />
				<span>{t("chat.attention.needed")}</span>
				<span className="text-text-muted tr-text-metadata">{t("chat.attention.waiting")}</span>
			</span>
			{live ? (
				<span role="status" aria-live="polite" className="sr-only">
					{announced ? t("chat.attention.announcement") : ""}
				</span>
			) : null}
		</div>
	);
}
