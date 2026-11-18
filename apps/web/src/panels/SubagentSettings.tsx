import {
	isSubagentMaxConcurrent,
	SUBAGENT_CATALOG_PROTOCOL_VERSION,
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	SUBAGENT_MAX_CONCURRENT,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import type { ReactNode } from "react";
import {
	SettingsChoice,
	SettingsGroup,
	SettingsNumberField,
	SettingsPage,
	type SettingsReset,
	SettingsRow,
} from "@/settingsKit";
import { workspaceName } from "../store";
import { SETTING, settingProps } from "./settingsCatalog";

type WorkspaceChoice = "global" | SubagentOverride;

export function SubagentSettings({
	protocolVersion,
	globalEnabled,
	globalLimit,
	workspace,
	globalEnabledReset,
	globalLimitReset,
	onGlobalEnabledChange,
	onWorkspaceEnabledChange,
	onGlobalLimitChange,
	onWorkspaceLimitChange,
	roster,
}: {
	protocolVersion: number | null;
	globalEnabled: boolean;
	globalLimit: number;
	workspace: Workspace | null;
	globalEnabledReset?: SettingsReset | undefined;
	globalLimitReset?: SettingsReset | undefined;
	onGlobalEnabledChange: (enabled: boolean) => void;
	onWorkspaceEnabledChange: (override: SubagentOverride | null) => void;
	onGlobalLimitChange: (value: number) => undefined | Promise<boolean>;
	onWorkspaceLimitChange: (value: number | null) => void;
	roster?: ReactNode;
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
	const choice: WorkspaceChoice = enabledOverride ?? "global";
	const globalState = t(
		globalEnabled ? "settings.subagents.globalStateOn" : "settings.subagents.globalStateOff",
	);

	return (
		<SettingsPage
			testId="settings-subagents"
			title={t("settings.nav.subagents")}
			description={t("settings.subagents.description")}
		>
			<SettingsGroup testId="subagents-global" title={t("settings.subagents.globalHeading")}>
				<SettingsRow
					{...settingProps(t, SETTING.subagentsAllow)}
					description={
						globalEnabled
							? t("settings.subagents.allowOnDescription")
							: t("settings.subagents.allowOffDescription")
					}
					control={
						<Switch
							checked={globalEnabled}
							label={t("settings.subagents.allowGlobally")}
							testId="subagents-global-toggle"
							tabIndex={0}
							onCheckedChange={onGlobalEnabledChange}
						/>
					}
					reset={globalEnabledReset}
				/>
				{limitSupported ? (
					<SettingsRow
						{...settingProps(t, SETTING.subagentsPerChat)}
						control={
							<SettingsNumberField
								label={t("settings.subagents.globalLimitLabel")}
								value={globalLimit}
								min={SUBAGENT_MAX_CONCURRENT.min}
								max={SUBAGENT_MAX_CONCURRENT.max}
								testId="subagent-limit-global-input"
								onCommit={onGlobalLimitChange}
							/>
						}
						reset={globalLimitReset}
					/>
				) : null}
				{workspace ? null : (
					<p
						data-testid="subagents-workspace-hint"
						className="pt-8 text-text-muted tr-text-metadata"
					>
						{t("settings.subagents.workspaceHint")}
					</p>
				)}
			</SettingsGroup>
			{workspace ? (
				<SettingsGroup
					testId="subagents-workspace-heading"
					title={t("settings.subagents.workspaceGroup")}
					scope="workspace"
					description={
						<span className="wrap-anywhere">
							{t("settings.subagents.workspaceDescription", { name: workspaceLabel })}
						</span>
					}
				>
					<SettingsRow
						{...settingProps(t, SETTING.subagentsWorkspace)}
						testId="subagents-workspace-row"
						description={
							enabledOverride === undefined
								? t("settings.subagents.followsGlobal", { state: globalState })
								: t("settings.catalog.subagentsWorkspace.description")
						}
						control={
							<SettingsChoice<WorkspaceChoice>
								label={t("settings.subagents.allowInWorkspace", { name: workspaceLabel })}
								testId="subagents-workspace-toggle"
								cost="cheap"
								value={choice}
								options={[
									{
										id: "global",
										label: t("settings.subagents.source.useGlobal"),
										testId: "subagents-workspace-global",
									},
									{
										id: "on",
										label: t("settings.subagents.overrideOn"),
										testId: "subagents-workspace-on",
									},
									{
										id: "off",
										label: t("settings.subagents.overrideOff"),
										testId: "subagents-workspace-off",
									},
								]}
								onSelect={(next) => onWorkspaceEnabledChange(next === "global" ? null : next)}
							/>
						}
						reset={{
							changed: enabledOverride !== undefined,
							onReset: () => onWorkspaceEnabledChange(null),
						}}
					/>
					{limitSupported ? (
						<SettingsRow
							{...settingProps(t, SETTING.subagentsWorkspaceLimit)}
							testId="subagent-limit-workspace-row"
							description={
								workspaceEnabled
									? t("settings.subagents.workspaceLimitDescription", { limit: globalLimit })
									: t("settings.subagents.workspaceLimitOff")
							}
							control={
								<SettingsNumberField
									label={t("settings.subagents.workspaceLimitLabel", { name: workspaceLabel })}
									value={limitOverride ?? null}
									min={SUBAGENT_MAX_CONCURRENT.min}
									max={SUBAGENT_MAX_CONCURRENT.max}
									placeholder={String(globalLimit)}
									disabled={!workspaceEnabled}
									testId="subagent-limit-workspace-input"
									onCommit={(value) => {
										onWorkspaceLimitChange(value);
										return undefined;
									}}
									onClear={() => {
										onWorkspaceLimitChange(null);
										return undefined;
									}}
								/>
							}
							reset={{
								changed: limitOverride !== undefined,
								onReset: () => onWorkspaceLimitChange(null),
							}}
						/>
					) : null}
				</SettingsGroup>
			) : null}
			{protocolVersion >= SUBAGENT_CATALOG_PROTOCOL_VERSION ? roster : null}
		</SettingsPage>
	);
}
