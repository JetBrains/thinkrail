import { RiBookOpenLine as BookOpen } from "@remixicon/react";
import { IconTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
	return (
		<IconTooltip label={stale ? "Skills changed on disk — reload" : "Skills"}>
			<button
				type="button"
				data-testid={testId}
				data-stale={stale ? "true" : undefined}
				onClick={onOpen}
				className={cn(
					"flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 py-2 text-text-muted tr-text-metadata outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary",
					className,
				)}
			>
				<BookOpen className="size-14" />
				Skills
				{stale ? <span className="size-6 rounded-full bg-feedback-warning" aria-hidden /> : null}
			</button>
		</IconTooltip>
	);
}
