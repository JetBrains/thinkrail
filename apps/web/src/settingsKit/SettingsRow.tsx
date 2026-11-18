import { RiArrowGoBackLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { SETTINGS_TAG } from "./SettingsGroup";
import { focusUnitStop } from "./settingsWalk";

export interface SettingsReset {
	changed: boolean;
	onReset: () => void;
	disabled?: boolean;
}

export interface SettingsRowProps {
	settingId?: string | undefined;
	rowId?: string | undefined;
	label: string;
	description?: ReactNode;
	control?: ReactNode;
	sides?: ReactNode;
	reset?: SettingsReset | undefined;
	nested?: boolean;
	testId?: string;
}

export function SettingsRow({
	settingId,
	rowId,
	label,
	description,
	control,
	sides,
	reset,
	nested = false,
	testId,
}: SettingsRowProps) {
	const t = useT();
	const changed = reset?.changed === true;
	return (
		<div
			data-setting-row={rowId ?? settingId}
			data-setting-id={settingId}
			data-changed={changed || undefined}
			data-testid={testId}
			className={cn(
				"flex flex-wrap items-center justify-between gap-12 border-border-muted border-b py-12",
				nested && "pl-16",
			)}
		>
			<div className="flex min-w-160 flex-1 flex-col gap-2">
				<div className="flex flex-wrap items-center gap-8">
					<span className="tr-text-ui text-text-default">{label}</span>
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
			<div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-8">
				{control ? (
					<div data-setting-control="" className="max-w-full">
						{control}
					</div>
				) : null}
				{sides}
				{reset && changed ? (
					<Button
						variant="ghost"
						size="m"
						iconLeft={RiArrowGoBackLine}
						tabIndex={0}
						disabled={reset.disabled}
						data-setting-side=""
						data-setting-reset=""
						data-testid={settingId ? `settings-reset-${settingId}` : undefined}
						aria-label={t("settings.kit.resetLabel", { label })}
						onClick={(event) => {
							focusUnitStop<HTMLElement>(event.currentTarget);
							reset.onReset();
						}}
					>
						{t("settings.kit.reset")}
					</Button>
				) : null}
			</div>
		</div>
	);
}
