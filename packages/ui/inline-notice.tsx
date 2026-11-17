import {
	RiAlertLine,
	RiCheckboxCircleLine,
	RiErrorWarningLine,
	RiInformationLine,
} from "@remixicon/react";
import type { ReactNode } from "react";
import { cn } from "./utils";

export type InlineNoticeVariant = "neutral" | "info" | "success" | "warning" | "error";

const VARIANTS = {
	neutral: { border: "border-border-default", icon: "text-text-muted", Icon: RiInformationLine },
	info: {
		border: "border-feedback-info-muted",
		icon: "text-feedback-info",
		Icon: RiInformationLine,
	},
	success: {
		border: "border-feedback-success-muted",
		icon: "text-feedback-success",
		Icon: RiCheckboxCircleLine,
	},
	warning: {
		border: "border-feedback-warning-muted",
		icon: "text-feedback-warning",
		Icon: RiAlertLine,
	},
	error: {
		border: "border-feedback-error-muted",
		icon: "text-feedback-error",
		Icon: RiErrorWarningLine,
	},
} satisfies Record<
	InlineNoticeVariant,
	{ border: string; icon: string; Icon: typeof RiInformationLine }
>;

export interface InlineNoticeProps {
	variant: InlineNoticeVariant;
	icon?: ReactNode;
	hideIcon?: boolean;
	children: ReactNode;
	action?: ReactNode;
	compact?: boolean;
	testId?: string;
	className?: string;
}

export function InlineNotice({
	variant,
	icon,
	hideIcon = false,
	children,
	action,
	compact = false,
	testId,
	className,
}: InlineNoticeProps) {
	const styles = VARIANTS[variant];
	const Icon = styles.Icon;
	return (
		<div
			role="status"
			data-testid={testId}
			data-variant={variant}
			className={cn(
				"flex flex-col gap-8 rounded-sm border bg-container-elevated-bg",
				styles.border,
				compact ? "px-8 py-4" : "px-12 py-8",
				className,
			)}
		>
			<div className="flex min-w-0 items-start gap-8">
				{!hideIcon && (
					<span aria-hidden="true" className={cn("mt-2 shrink-0", styles.icon)}>
						{icon ?? <Icon className="size-14" />}
					</span>
				)}
				<div className="flex min-w-0 flex-1 flex-col gap-4 tr-text-ui text-text-default">
					{children}
				</div>
			</div>
			{action ? <div className="flex min-w-0 flex-wrap justify-end gap-8">{action}</div> : null}
		</div>
	);
}
