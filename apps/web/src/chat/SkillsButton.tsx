import { RiBookOpenLine as BookOpen } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
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
			<Button
				variant="ghost"
				size="s"
				iconLeft={BookOpen}
				data-testid={testId}
				data-stale={stale ? "true" : undefined}
				onClick={onOpen}
				className={cn("shrink-0", className)}
			>
				{t("chat.skills.title")}
				{stale ? <span className="size-6 rounded-full bg-feedback-warning" aria-hidden /> : null}
			</Button>
		</IconTooltip>
	);
}
