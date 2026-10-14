import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

export const SETTINGS_ROWS_CONTAINER = "flex flex-col [&>*:last-child]:border-b-0";

export interface SettingsRowProps {
	label: string;
	description?: ReactNode;
	control: ReactNode;
	testId?: string;
	noBorder?: boolean;
	className?: string;
}

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
				{description ? (
					<span className="tr-text-metadata text-text-muted">{description}</span>
				) : null}
			</div>
			<div className="shrink-0">{control}</div>
		</div>
	);
}
