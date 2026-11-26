import {
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	WORKTREE_DIRECTORY_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import {
	SETTINGS_INPUT,
	SETTINGS_ROWS,
	SettingsChoice,
	SettingsPage,
	type SettingsReset,
	SettingsRow,
	useSettingsDraft,
} from "@/settingsKit";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { saveSettings } from "./saveSettings";
import { useConfigReset } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

type IdleChoice = `${number}` | "never";

interface IdleChoiceSpec {
	id: IdleChoice;
	days: number | null;
	hint?: MessageKey;
	description: MessageKey;
	testId: string;
}

const FAILURE = "settings.workspaces.changeFailed";

const IDLE_CHOICES: readonly IdleChoiceSpec[] = [
	{ id: "1", days: 1, description: "settings.workspaces.idle.oneDay", testId: "settle-idle-1" },
	{ id: "3", days: 3, description: "settings.workspaces.idle.threeDays", testId: "settle-idle-3" },
	{
		id: "7",
		days: 7,
		hint: "settings.workspaces.idle.defaultHint",
		description: "settings.workspaces.idle.sevenDays",
		testId: "settle-idle-7",
	},
	{
		id: "14",
		days: 14,
		description: "settings.workspaces.idle.fourteenDays",
		testId: "settle-idle-14",
	},
	{
		id: "never",
		days: null,
		description: "settings.workspaces.idle.never",
		testId: "settle-idle-never",
	},
];

export function toChoice(days: number | null): IdleChoice {
	return days === null ? "never" : (String(days) as IdleChoice);
}

export function idleDescription(pending: IdleChoice | null, value: IdleChoice): MessageKey | null {
	const shown = pending ?? value;
	return IDLE_CHOICES.find((choice) => choice.id === shown)?.description ?? null;
}

function isAbsolutePath(value: string): boolean {
	const path = value.trim();
	return (
		path === "" || path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path)
	);
}

export function WorkspacesSettings() {
	const t = useT();
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const worktreeDirectory = useAppStore((s) => s.worktreeDirectory);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const settleReset = useConfigReset("settleIdleDays", FAILURE);
	const directoryReset = useConfigReset("worktreeDirectory", FAILURE);
	const supported =
		protocolVersion !== null && protocolVersion >= WORKSPACE_SETTLE_PROTOCOL_VERSION;
	const directorySupported =
		protocolVersion !== null && protocolVersion >= WORKTREE_DIRECTORY_PROTOCOL_VERSION;

	const select = (choice: IdleChoice) => {
		const next = choice === "never" ? null : Number(choice);
		if (next === settleIdleDays) return;
		void saveSettings({ settleIdleDays: next }, t(FAILURE));
	};

	return (
		<WorkspacesSettingsView
			settleIdleDays={settleIdleDays}
			supported={supported}
			reset={settleReset}
			onSelect={select}
			worktreeDirectory={worktreeDirectory}
			directorySupported={directorySupported}
			directoryReset={directoryReset}
			onSaveDirectory={(directory) => saveSettings({ worktreeDirectory: directory }, t(FAILURE))}
			onPickDirectory={() =>
				getTransport()
					.request("dialog.selectDirectory", {})
					.then(({ path }) => path)
			}
		/>
	);
}

export function WorkspacesSettingsView({
	settleIdleDays,
	supported,
	reset,
	onSelect,
	worktreeDirectory,
	directorySupported,
	directoryReset,
	onSaveDirectory,
	onPickDirectory,
}: {
	settleIdleDays: number | null;
	supported: boolean;
	reset: SettingsReset;
	onSelect: (choice: IdleChoice) => void;
	worktreeDirectory: string | undefined;
	directorySupported: boolean;
	directoryReset: SettingsReset;
	onSaveDirectory: (directory: string | null) => Promise<boolean>;
	onPickDirectory: () => Promise<string | null>;
}) {
	const t = useT();
	const [pending, setPending] = useState<IdleChoice | null>(null);
	const value = toChoice(settleIdleDays);
	const description = idleDescription(pending, value);
	const directoryDraft = useSettingsDraft({
		saved: worktreeDirectory ?? "",
		isValid: isAbsolutePath,
		commit: (draft) => onSaveDirectory(draft.trim() || null),
	});
	const label = (days: number | null) =>
		days === null
			? t("settings.workspaces.idle.neverLabel")
			: t("settings.workspaces.idle.days", { count: days });

	return (
		<SettingsPage
			title={t("settings.nav.workspaces")}
			description={t("settings.workspaces.description")}
			testId="settings-workspaces"
		>
			<div className={SETTINGS_ROWS}>
				{directorySupported ? (
					<SettingsRow
						{...settingProps(t, SETTING.worktreeDirectory)}
						reset={directoryReset}
						control={
							<span className="flex min-w-0 flex-wrap items-center justify-end gap-4">
								<input
									{...directoryDraft.inputProps}
									aria-label={t(SETTING.worktreeDirectory.label)}
									data-testid="settings-worktree-directory"
									placeholder={t("settings.workspaces.directoryDefault")}
									className={cn(SETTINGS_INPUT, "w-[20rem] max-w-full tr-code-text")}
								/>
								<Button
									variant="outline"
									size="s"
									data-testid="settings-worktree-directory-browse"
									onClick={() =>
										void onPickDirectory().then((path) => {
											if (path) directoryDraft.submit(path);
										})
									}
								>
									{t("settings.workspaces.directoryBrowse")}
								</Button>
							</span>
						}
					/>
				) : null}
				<SettingsRow
					{...settingProps(t, SETTING.settleIdle)}
					description={description ? t(description) : label(settleIdleDays)}
					reset={reset}
					control={
						<SettingsChoice
							label={t(SETTING.settleIdle.label)}
							cost="expensive"
							options={IDLE_CHOICES.map(({ id, days, hint, testId }) => ({
								id,
								label: label(days),
								...(hint ? { hint: t(hint) } : {}),
								testId,
							}))}
							value={value}
							disabled={!supported}
							onSelect={onSelect}
							onPendingChange={setPending}
						/>
					}
				/>
			</div>
		</SettingsPage>
	);
}
