import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Skills-manager trigger: a `BookOpen` pill labelled "Skills". Shared by the chat header (workspace
 * mode — passes `stale` for the on-disk-changed badge + Reload tooltip) and `panels/NewWorkspaceDialog`
 * (project mode, no session, no stale) so the two triggers cannot drift. Presentational: the owner wires
 * `onOpen`, supplies its own stable `testId`, and passes positioning via `className` (e.g. `ml-auto`).
 */
export function SkillsButton({
	onOpen,
	testId,
	stale,
	className,
}: {
	onOpen: () => void;
	/** The owner's stable test hook (differs per surface). */
	testId: string;
	/** The worktree's skills changed on disk since load — badge the trigger + swap the tooltip. */
	stale?: boolean;
	/** Positioning utilities from the owner (merged onto the shared look). */
	className?: string;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			data-stale={stale ? "true" : undefined}
			onClick={onOpen}
			title={stale ? "Skills changed on disk — reload" : "Skills"}
			className={cn(
				"flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-0.5 text-muted text-xs outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary",
				className,
			)}
		>
			<BookOpen className="size-3.5" />
			Skills
			{stale ? <span className="size-1.5 rounded-full bg-gold" aria-hidden /> : null}
		</button>
	);
}
