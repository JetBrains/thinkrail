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
import { useEffect, useState } from "react";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";

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
		<button
			type="button"
			data-testid={testId}
			data-source="custom"
			aria-label={resetLabel}
			title={t("settings.subagents.source.useGlobal")}
			onClick={onReset}
			className="inline-flex items-center gap-2 rounded-sm px-4 text-primary tr-text-metadata outline-none hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-primary"
		>
			{t("settings.subagents.source.custom")}
			<RiArrowGoBackLine aria-hidden className="size-12" />
		</button>
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
	const savedText = saved === undefined ? "" : String(saved);
	const [draft, setDraft] = useState(savedText);
	const [submitted, setSubmitted] = useState<string | null>(null);
	useEffect(() => {
		setDraft(savedText);
		setSubmitted(null);
	}, [savedText]);
	const parsed = parseLimit(draft);
	const invalid = parsed === null && !(allowEmpty && draft === "");
	const errorId = `${testId}-error`;

	const commit = () => {
		if (invalid || draft === savedText || draft === submitted) return;
		setSubmitted(draft);
		onCommit(parsed);
	};

	return (
		<span className="flex flex-col items-end gap-2">
			<input
				type="number"
				min={SUBAGENT_MAX_CONCURRENT.min}
				max={SUBAGENT_MAX_CONCURRENT.max}
				step={1}
				inputMode="numeric"
				value={draft}
				placeholder={placeholder === undefined ? undefined : String(placeholder)}
				disabled={disabled}
				aria-label={label}
				aria-invalid={invalid}
				aria-describedby={invalid ? errorId : undefined}
				data-testid={testId}
				data-settings-draft-input
				onChange={(event) => {
					setDraft(event.currentTarget.value);
					setSubmitted(null);
				}}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						setDraft(savedText);
					}
				}}
				className="h-32 w-64 rounded-sm border border-control-border-default bg-control-bg px-8 text-right tr-text-ui text-text-default outline-none placeholder:text-text-subtle focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text aria-invalid:border-feedback-error"
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
				<div
					data-testid="subagents-workspace-heading"
					title={workspace.name}
					className="flex min-w-0 flex-col gap-2 pt-16 pb-4"
				>
					<span className="tr-text-ui text-text-default">
						{t("settings.subagents.workspaceHeading")}
					</span>
					<span className="break-words text-text-muted tr-text-metadata">
						{t("settings.subagents.workspaceDescription", { name: workspace.name })}
					</span>
				</div>
			) : null}
			{workspace ? (
				<SettingsRow
					label={t("settings.subagents.allow")}
					control={
						<span className="flex items-center gap-8">
							<SourceTag
								custom={enabledOverride !== undefined}
								resetLabel={t("settings.subagents.resetEnabled", { name: workspace.name })}
								testId="subagents-workspace-source"
								onReset={() => onWorkspaceEnabledChange(null)}
							/>
							<SettingsSwitch
								checked={workspaceEnabled}
								label={t("settings.subagents.allowInWorkspace", { name: workspace.name })}
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
									resetLabel={t("settings.subagents.resetLimit", { name: workspace.name })}
									testId="subagent-limit-workspace-source"
									onReset={() => onWorkspaceLimitChange(null)}
								/>
							</span>
							<LimitField
								saved={limitOverride}
								placeholder={globalLimit}
								allowEmpty
								disabled={!workspaceEnabled}
								label={t("settings.subagents.workspaceLimitLabel", { name: workspace.name })}
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
