import { RiArrowGoBackLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { SETTINGS_TAG, type SettingsReset } from "@/settingsKit";

export interface SettingsStackedRowProps {
	settingId: string;
	label: string;
	description?: ReactNode;
	reset?: SettingsReset | undefined;
	card?: boolean;
	testId?: string;
	children: ReactNode;
}

export function SettingsStackedRow({
	settingId,
	label,
	description,
	reset,
	card = false,
	testId,
	children,
}: SettingsStackedRowProps) {
	const t = useT();
	const changed = reset?.changed === true;
	return (
		<div
			data-setting-row={settingId}
			data-setting-id={settingId}
			data-changed={changed || undefined}
			data-testid={testId}
			className={cn(
				"flex min-w-0 flex-col gap-8",
				card
					? "rounded-md border border-border-default bg-clip-padding pt-8"
					: "border-border-muted border-b py-12",
			)}
		>
			<div className={cn("flex items-start gap-8", card && "px-12")}>
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<div className="flex flex-wrap items-center gap-8">
						<span
							className={
								card ? "tr-title-compact text-text-default" : "tr-text-ui text-text-default"
							}
						>
							{label}
						</span>
						{changed ? (
							<span data-setting-changed="" className={cn(SETTINGS_TAG, "text-primary")}>
								{t("settings.kit.changed")}
							</span>
						) : null}
					</div>
					{description ? (
						<div className="break-words tr-text-metadata text-text-muted">{description}</div>
					) : null}
				</div>
				{reset && changed ? (
					<Button
						variant="ghost"
						size="m"
						iconLeft={RiArrowGoBackLine}
						tabIndex={0}
						disabled={reset.disabled}
						data-setting-side=""
						data-setting-reset=""
						data-testid={`settings-reset-${settingId}`}
						aria-label={t("settings.kit.resetLabel", { label })}
						onClick={reset.onReset}
					>
						{t("settings.kit.reset")}
					</Button>
				) : null}
			</div>
			<div data-setting-control="" className={cn(card && "border-border-muted border-t p-4")}>
				{children}
			</div>
		</div>
	);
}
