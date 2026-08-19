import { FileIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The one chip skin shared by the composer's pending-attachment chips, its attach-error chips, and
 * the transcript's `AttachmentChip` (turns.tsx) — a single source so they can't drift apart. Only the
 * colour tokens vary by tone. */
const CHIP_BASE =
	"flex items-center gap-xs whitespace-nowrap rounded-[var(--radius-sm)] border bg-clip-padding px-sm py-xs tr-text-metadata";
const CHIP_TONE = {
	default: "border-border-default bg-container-elevated-bg text-text-default",
	error: "border-feedback-error-muted bg-feedback-error-subtle text-feedback-error",
} as const;

interface FileChipProps {
	label: ReactNode;
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
	trailing,
	onClick,
	tone = "default",
	icon = true,
	...rest
}: FileChipProps) {
	const chip = `${CHIP_BASE} ${CHIP_TONE[tone]}`;
	const content = (
		<>
			{icon ? <FileIcon className="size-3" /> : null} {label}
			{trailing}
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
