import { RiBookOpenLine as BookOpen } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";

export function SkillsButton({
	onOpen,
	testId,
	stale,
	className,
}: {
	onOpen: () => void;
	testId: string;
	stale?: boolean;
	className?: string;
}) {
	const t = useT();
	return (
		<IconTooltip label={stale ? t("chat.skills.buttonStale") : t("chat.skills.title")}>
			<button
				type="button"
				data-testid={testId}
				data-stale={stale ? "true" : undefined}
				onClick={onOpen}
				className={cn(
					"flex shrink-0 items-center gap-4 rounded-sm px-8 py-2 text-text-muted tr-text-metadata outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary",
					className,
				)}
			>
				<BookOpen className="size-14" />
				{t("chat.skills.title")}
				{stale ? <span className="size-6 rounded-full bg-feedback-warning" aria-hidden /> : null}
			</button>
		</IconTooltip>
	);
}
