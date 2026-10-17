import { RiQuestionnaireLine as MessageCircleQuestion } from "@remixicon/react";

export function AttentionLine({
	announced = false,
	live = true,
}: {
	announced?: boolean;
	live?: boolean;
}) {
	return (
		<div className="flex items-center gap-4 text-primary tr-text-action">
			<span aria-hidden={!live || announced || undefined} className="flex items-center gap-4">
				<MessageCircleQuestion className="size-14 shrink-0" />
				<span>Your input is needed</span>
				<span className="text-text-muted tr-text-metadata">· Agent is waiting</span>
			</span>
			{live ? (
				<span role="status" aria-live="polite" className="sr-only">
					{announced ? "Your input is needed — the agent is waiting." : ""}
				</span>
			) : null}
		</div>
	);
}
