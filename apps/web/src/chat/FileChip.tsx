import { FileIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The one chip skin shared by the composer's pending-attachment chips, its attach-error chips, and
 * the transcript's `AttachmentChip` (turns.tsx) — a single source so they can't drift apart. Only the
 * colour tokens vary by tone.
 *
 * `max-w-full` is load-bearing: labels are user-controlled filenames, and the chip lives in a
 * flex-wrap strip inside the composer or a transcript bubble whose scroller is `overflow-x-hidden`.
 * Unbounded, one long name pushes the chip past the viewport — its remove button off-screen in the
 * composer, its text clipped and unreachable in the transcript. The label truncates instead (see
 * `content` below); the icon, the `meta` suffix, and the trailing action never shrink. */
const CHIP_BASE =
	"flex max-w-full items-center gap-xs rounded-[var(--radius-sm)] border bg-clip-padding px-sm py-xs tr-text-metadata";
const CHIP_TONE = {
	default: "border-border-default bg-container-elevated-bg text-text-default",
	error: "border-feedback-error-muted bg-feedback-error-subtle text-feedback-error",
} as const;

interface FileChipProps {
	/** The truncating part — a user-controlled filename or message; anything that must stay readable
	 * on a narrow viewport belongs in `meta` instead. */
	label: ReactNode;
	/** Short suffix kept fully visible while `label` truncates — the `· W×H` size, an error's reason. */
	meta?: ReactNode;
	/** Optional trailing slot — e.g. the composer chip's remove button. */
	trailing?: ReactNode;
	/** When set, the chip renders as a button with interaction states; a static span otherwise. */
	onClick?: () => void;
	/** Colour tone — `error` renders the feedback-error tokens (attach failures); default otherwise. */
	tone?: keyof typeof CHIP_TONE;
	/** The file icon is the norm; an error chip carries its message instead. */
	icon?: boolean;
	title?: string;
	"aria-label"?: string;
	"data-testid"?: string;
	"data-width"?: number | undefined;
	"data-height"?: number | undefined;
	/** The wire media type actually being sent — the e2e hook pinning the re-encode rule. */
	"data-mime"?: string | undefined;
}

/** A compact "attached file" chip: file icon + label (+ trailing slot). */
export function FileChip({
	label,
	meta,
	trailing,
	onClick,
	tone = "default",
	icon = true,
	...rest
}: FileChipProps) {
	const chip = `${CHIP_BASE} ${CHIP_TONE[tone]}`;
	const content = (
		<>
			{icon ? <FileIcon className="size-3 shrink-0" /> : null}
			<span className="min-w-0 truncate">{label}</span>
			{meta ? <span className="shrink-0">{meta}</span> : null}
			{trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
		</>
	);
	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				className={`${chip} transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary`}
				{...rest}
			>
				{content}
			</button>
		);
	}
	return (
		<span className={chip} {...rest}>
			{content}
		</span>
	);
}
