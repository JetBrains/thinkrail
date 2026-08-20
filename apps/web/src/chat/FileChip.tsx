import { FileIcon } from "lucide-react";
import type { ReactNode } from "react";

const CHIP_BASE =
	"flex max-w-full items-center gap-xs rounded-[var(--radius-sm)] border bg-clip-padding px-sm py-xs tr-text-metadata";
const CHIP_TONE = {
	default: "border-border-default bg-container-elevated-bg text-text-default",
	error: "border-feedback-error-muted bg-feedback-error-subtle text-feedback-error",
} as const;

interface FileChipProps {
	label: ReactNode;
	meta?: ReactNode;
	trailing?: ReactNode;
	onClick?: () => void;
	tone?: keyof typeof CHIP_TONE;
	icon?: boolean;
	title?: string;
	"aria-label"?: string;
	"data-testid"?: string;
	"data-width"?: number | undefined;
	"data-height"?: number | undefined;
	"data-mime"?: string | undefined;
}

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
