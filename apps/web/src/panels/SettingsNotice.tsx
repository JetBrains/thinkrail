import {
	RiErrorWarningLine as AlertCircle,
	RiAlertLine as AlertTriangle,
	RiCheckLine as Check,
	RiInformationLine as Info,
} from "@remixicon/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

export type SettingsNoticeVariant = "neutral" | "info" | "success" | "warning" | "error";

const VARIANT_STYLES: Record<SettingsNoticeVariant, { bg: string; icon: string }> = {
	neutral: { bg: "bg-control-bg", icon: "text-text-muted" },
	info: { bg: "bg-control-bg", icon: "text-feedback-info" },
	success: { bg: "bg-control-bg", icon: "text-feedback-success" },
	warning: { bg: "bg-control-bg", icon: "text-feedback-warning" },
	error: { bg: "bg-control-bg", icon: "text-feedback-error" },
};

const VARIANT_ICONS: Record<SettingsNoticeVariant, typeof Info> = {
	neutral: Info,
	info: Info,
	success: Check,
	warning: AlertTriangle,
	error: AlertCircle,
};

export interface SettingsNoticeProps {
	/** Visual variant determining background and icon color */
	variant: SettingsNoticeVariant;
	/** Optional icon override - defaults to variant-appropriate icon */
	icon?: ReactNode;
	/** Hide the icon entirely */
	hideIcon?: boolean;
	/** Main notice text */
	children: ReactNode;
	/** Optional action button/link */
	action?: ReactNode;
	/** Test ID for the notice container */
	testId?: string;
	/** Additional class names */
	className?: string;
}

/**
 * A shared notice component for Settings screens.
 * Uses semantic background fills without visible borders.
 * Supports informational, success, warning, and error states.
 */
export function SettingsNotice({
	variant,
	icon,
	hideIcon = false,
	children,
	action,
	testId,
	className,
}: SettingsNoticeProps) {
	const styles = VARIANT_STYLES[variant];
	const IconComponent = VARIANT_ICONS[variant];

	return (
		<div
			data-testid={testId}
			data-variant={variant}
			className={cn("flex items-start gap-8 rounded-sm px-12 py-8", styles.bg, className)}
		>
			{!hideIcon && (
				<span className={cn("mt-2 shrink-0", styles.icon)}>
					{icon ?? <IconComponent className="size-14" />}
				</span>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-4">
				<div className="tr-text-ui text-text-default">{children}</div>
				{action && <div className="flex items-center gap-8">{action}</div>}
			</div>
		</div>
	);
}
