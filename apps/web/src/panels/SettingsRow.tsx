import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

/**
 * CSS class for settings containers that automatically hides the bottom border
 * on the last direct child. Apply this to the parent flex container.
 *
 * @example
 * ```tsx
 * <div className={SETTINGS_ROWS_CONTAINER}>
 *   <SettingsRow ... />
 *   <SettingsRow ... />
 *   <SettingsRow ... /> // border automatically hidden
 * </div>
 * ```
 */
export const SETTINGS_ROWS_CONTAINER = "flex flex-col [&>*:last-child]:border-b-0";

export interface SettingsRowProps {
	/** Primary label for the setting */
	label: string;
	/** Optional description shown below the label */
	description?: string | undefined;
	/** Control element (switch, button, dropdown, etc.) */
	control: ReactNode;
	/** Test ID for the row */
	testId?: string;
	/**
	 * Whether to hide the bottom border.
	 * When inside a SETTINGS_ROWS_CONTAINER, the last child's border is hidden automatically.
	 * Use this prop only for explicit overrides (e.g., disclosure content inside a row).
	 */
	noBorder?: boolean;
	/** Optional className for the container */
	className?: string;
}

/**
 * A setting row with label + optional description on the left, control on the right.
 * Includes a muted bottom border by default to separate from the next setting.
 *
 * When placed inside a container with SETTINGS_ROWS_CONTAINER class, the last row's
 * bottom border is automatically hidden via CSS :last-child selector.
 */
export function SettingsRow({
	label,
	description,
	control,
	testId,
	noBorder = false,
	className,
}: SettingsRowProps) {
	return (
		<div
			data-testid={testId}
			className={cn(
				"flex items-center justify-between gap-12 py-12",
				!noBorder && "border-border-muted border-b",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="tr-text-ui text-text-default">{label}</span>
				{description && <span className="tr-text-metadata text-text-muted">{description}</span>}
			</div>
			<div className="shrink-0">{control}</div>
		</div>
	);
}

/**
 * @deprecated Use SettingsRow instead. Cards are being removed in favor of
 * typography and dividers for visual hierarchy.
 */
export interface SettingsCardRowProps extends Omit<SettingsRowProps, "noBorder"> {}

/**
 * @deprecated Use SettingsRow instead. Cards are being removed in favor of
 * typography and dividers for visual hierarchy.
 */
export function SettingsCardRow(props: SettingsCardRowProps) {
	return <SettingsRow {...props} />;
}
