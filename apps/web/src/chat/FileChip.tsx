import { FileIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The one chip skin shared by the composer's pending-attachment chips and the transcript's
 * `AttachmentChip` (turns.tsx) — a single source so the two can't drift apart. */
const CHIP =
	"flex items-center gap-xs whitespace-nowrap rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs text-text-default tr-text-metadata";

interface FileChipProps {
	label: ReactNode;
	/** Optional trailing slot — e.g. the composer chip's remove button. */
	trailing?: ReactNode;
	/** When set, the chip renders as a button with interaction states; a static span otherwise. */
	onClick?: () => void;
	title?: string;
	"aria-label"?: string;
	"data-testid"?: string;
	"data-width"?: number | undefined;
	"data-height"?: number | undefined;
	/** The wire media type actually being sent — the e2e hook pinning the re-encode rule. */
	"data-mime"?: string | undefined;
}

/** A compact "attached file" chip: file icon + label (+ trailing slot). */
export function FileChip({ label, trailing, onClick, ...rest }: FileChipProps) {
	const content = (
		<>
			<FileIcon className="size-3" /> {label}
			{trailing}
		</>
	);
	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				className={`${CHIP} transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary`}
				{...rest}
			>
				{content}
			</button>
		);
	}
	return (
		<span className={CHIP} {...rest}>
			{content}
		</span>
	);
}
