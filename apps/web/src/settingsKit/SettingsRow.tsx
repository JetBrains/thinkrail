import { RiArrowGoBackLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useId } from "react";
import { SETTINGS_TAG } from "./SettingsGroup";
import { SETTINGS_ROW_FOCUS, SETTINGS_ROW_INSET, useSettingsRowRoving } from "./settingsRowCursor";
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
	layout?: "inline" | "stacked" | "card";
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
	layout = "inline",
	testId,
}: SettingsRowProps) {
	const t = useT();
	const labelId = useId();
	const descriptionId = useId();
	const row = rowId ?? settingId;
	const { tabIndex, ref } = useSettingsRowRoving(row);
	const changed = reset?.changed === true;
	const card = layout === "card";
	const inline = layout === "inline";
	const head = (
		<div className={cn("flex flex-1 flex-col gap-2", inline ? "min-w-160" : "min-w-0")}>
			<div className="flex flex-wrap items-center gap-8">
				<span
					id={labelId}
					className={card ? "tr-title-compact text-text-default" : "tr-text-ui text-text-default"}
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
				<div id={descriptionId} className="break-words tr-text-metadata text-text-muted">
					{description}
				</div>
			) : null}
		</div>
	);
	const resetSide =
		reset && changed ? (
			<Button
				variant="ghost"
				size="m"
				iconLeft={RiArrowGoBackLine}
				tabIndex={0}
				disabled={reset.disabled}
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
		) : null;
	return (
		<fieldset
			data-setting-row={row}
			data-setting-id={settingId}
			data-changed={changed || undefined}
			data-testid={testId}
			ref={ref}
			tabIndex={row === undefined ? undefined : tabIndex}
			aria-labelledby={labelId}
			aria-describedby={description ? descriptionId : undefined}
			className={cn(
				"min-w-0",
				row !== undefined && SETTINGS_ROW_FOCUS,
				inline
					? "flex flex-wrap items-center justify-between gap-12 border-border-muted border-b py-12"
					: "flex flex-col gap-8",
				!card && SETTINGS_ROW_INSET,
				layout === "stacked" && "border-border-muted border-b py-12",
				card && "rounded-md border border-border-default bg-clip-padding pt-8",
				nested && "pl-24",
			)}
		>
			{inline ? (
				<>
					{head}
					<div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-8">
						{control ? (
							<div data-setting-control="" className="max-w-full">
								{control}
							</div>
						) : null}
						{sides}
						{resetSide}
					</div>
				</>
			) : (
				<>
					<div className={cn("flex items-start gap-8", card && "px-12")}>
						{head}
						{sides}
						{resetSide}
					</div>
					<div data-setting-control="" className={cn(card && "border-border-muted border-t p-4")}>
						{control}
					</div>
				</>
			)}
		</fieldset>
	);
}
