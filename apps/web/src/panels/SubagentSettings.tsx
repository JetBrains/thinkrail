import { RiArrowGoBackLine } from "@remixicon/react";
import {
	isSubagentMaxConcurrent,
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	SUBAGENT_MAX_CONCURRENT,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { workspaceName } from "../store";
import { SettingsGroup, SettingsSubheading } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

function parseLimit(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return isSubagentMaxConcurrent(value) ? value : null;
}

function SourceTag({
	custom,
	resetLabel,
	testId,
	onReset,
}: {
	custom: boolean;
	resetLabel: string;
	testId: string;
	onReset: () => void;
}) {
	const t = useT();
	if (!custom) {
		return (
			<span
				data-testid={testId}
				data-source="global"
				className="rounded-sm px-4 text-text-subtle tr-text-metadata"
			>
				{t("settings.subagents.source.global")}
			</span>
		);
	}
	return (
		<Button
			variant="soft-primary"
			size="s"
			iconRight={RiArrowGoBackLine}
			data-testid={testId}
			data-source="custom"
			aria-label={resetLabel}
			tooltip={t("settings.subagents.source.useGlobal")}
			onClick={onReset}
		>
			{t("settings.subagents.source.custom")}
		</Button>
	);
}

function LimitField({
	saved,
	placeholder,
	allowEmpty,
	disabled = false,
	label,
	testId,
	onCommit,
}: {
	saved: number | undefined;
	placeholder?: number;
	allowEmpty: boolean;
	disabled?: boolean;
	label: string;
	testId: string;
	onCommit: (value: number | null) => void;
}) {
	const t = useT();
	const { invalid, inputProps } = useSettingsDraft({
		saved: saved === undefined ? "" : String(saved),
		isValid: (draft) => parseLimit(draft) !== null || (allowEmpty && draft === ""),
		commit: (draft) => {
			onCommit(parseLimit(draft));
			return undefined;
		},
	});
	const errorId = `${testId}-error`;

	return (
		<span className="flex flex-col items-end gap-2">
			<input
				type="number"
				min={SUBAGENT_MAX_CONCURRENT.min}
				max={SUBAGENT_MAX_CONCURRENT.max}
				step={1}
				inputMode="numeric"
				{...inputProps}
				placeholder={placeholder === undefined ? undefined : String(placeholder)}
				disabled={disabled}
				aria-label={label}
				aria-describedby={invalid ? errorId : undefined}
				data-testid={testId}
				className={cn(SETTINGS_INPUT, "w-64 text-right")}
			/>
			{invalid ? (
				<span id={errorId} className="text-feedback-error tr-text-metadata">
					{t("settings.subagents.limitRange", {
						min: SUBAGENT_MAX_CONCURRENT.min,
						max: SUBAGENT_MAX_CONCURRENT.max,
					})}
				</span>
			) : null}
		</span>
	);
}

export function SubagentSettings({
	protocolVersion,
	globalEnabled,
	globalLimit,
	workspace,
	onGlobalEnabledChange,
	onWorkspaceEnabledChange,
	onGlobalLimitChange,
	onWorkspaceLimitChange,
}: {
	protocolVersion: number | null;
	globalEnabled: boolean;
	globalLimit: number;
	workspace: Workspace | null;
	onGlobalEnabledChange: (enabled: boolean) => void;
	onWorkspaceEnabledChange: (override: SubagentOverride | null) => void;
	onGlobalLimitChange: (value: number) => void;
	onWorkspaceLimitChange: (value: number | null) => void;
}) {
	const t = useT();
	if (protocolVersion === null || protocolVersion < SUBAGENT_SETTINGS_PROTOCOL_VERSION) {
		return null;
	}
	const limitSupported = protocolVersion >= SUBAGENT_CONCURRENCY_PROTOCOL_VERSION;
	const enabledOverride = workspace?.subagentsOverride;
	const workspaceEnabled = enabledOverride === undefined ? globalEnabled : enabledOverride === "on";
	const rawLimitOverride = workspace?.subagentMaxConcurrentOverride;
	const limitOverride = isSubagentMaxConcurrent(rawLimitOverride) ? rawLimitOverride : undefined;
	const workspaceLabel = workspace ? workspaceName(t, workspace) : "";

	return (
		<SettingsGroup
			testId="settings-subagents"
			title={t("settings.subagents.title")}
			description={t("settings.subagents.description")}
		>
			<SettingsRow
				label={t("settings.subagents.allow")}
				description={
					globalEnabled
						? t("settings.subagents.allowOnDescription")
						: t("settings.subagents.allowOffDescription")
				}
				control={
					<SettingsSwitch
						checked={globalEnabled}
						label={t("settings.subagents.allowGlobally")}
						testId="subagents-global-toggle"
						onChange={onGlobalEnabledChange}
					/>
				}
			/>
			{limitSupported ? (
				<SettingsRow
					label={t("settings.subagents.perChat")}
					description={t("settings.subagents.perChatDescription")}
					control={
						<LimitField
							saved={globalLimit}
							allowEmpty={false}
							label={t("settings.subagents.globalLimitLabel")}
							testId="subagent-limit-global-input"
							onCommit={(value) => {
								if (value !== null) onGlobalLimitChange(value);
							}}
						/>
					}
				/>
			) : null}
			{workspace ? (
				<SettingsSubheading
					testId="subagents-workspace-heading"
					titleAttribute={workspaceLabel}
					title={t("settings.subagents.workspaceHeading")}
					description={t("settings.subagents.workspaceDescription", { name: workspaceLabel })}
				/>
			) : null}
			{workspace ? (
				<SettingsRow
					label={t("settings.subagents.allow")}
					control={
						<span className="flex items-center gap-8">
							<SourceTag
								custom={enabledOverride !== undefined}
								resetLabel={t("settings.subagents.resetEnabled", { name: workspaceLabel })}
								testId="subagents-workspace-source"
								onReset={() => onWorkspaceEnabledChange(null)}
							/>
							<SettingsSwitch
								checked={workspaceEnabled}
								label={t("settings.subagents.allowInWorkspace", { name: workspaceLabel })}
								testId="subagents-workspace-toggle"
								onChange={(enabled) => onWorkspaceEnabledChange(enabled ? "on" : "off")}
							/>
						</span>
					}
				/>
			) : null}
			{workspace && limitSupported ? (
				<SettingsRow
					label={t("settings.subagents.perChat")}
					control={
						<span className="flex items-start gap-8">
							<span className="flex h-32 items-center">
								<SourceTag
									custom={limitOverride !== undefined}
									resetLabel={t("settings.subagents.resetLimit", { name: workspaceLabel })}
									testId="subagent-limit-workspace-source"
									onReset={() => onWorkspaceLimitChange(null)}
								/>
							</span>
							<LimitField
								saved={limitOverride}
								placeholder={globalLimit}
								allowEmpty
								disabled={!workspaceEnabled}
								label={t("settings.subagents.workspaceLimitLabel", { name: workspaceLabel })}
								testId="subagent-limit-workspace-input"
								onCommit={onWorkspaceLimitChange}
							/>
						</span>
					}
				/>
			) : null}
		</SettingsGroup>
	);
}
