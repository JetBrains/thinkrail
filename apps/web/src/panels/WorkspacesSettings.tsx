import {
	isProjectsFolder,
	PROJECTS_FOLDER_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	WORKTREE_DIRECTORY_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useId, useState } from "react";
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

export interface ProjectsFolderField {
	value: string;
	reset: SettingsReset;
	onCommit: (next: string) => Promise<boolean>;
}

export interface WorktreeDirectoryField {
	value: string;
	reset: SettingsReset;
	onCommit: (next: string | null) => Promise<boolean>;
	onPick: () => Promise<string | null>;
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
	const projectsFolder = useAppStore((s) => s.projectsFolder);
	const worktreeDirectory = useAppStore((s) => s.worktreeDirectory);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const reset = useConfigReset("settleIdleDays", "settings.workspaces.changeFailed");
	const folderReset = useConfigReset(
		"projectsFolder",
		"settings.workspaces.projectsFolder.changeFailed",
	);
	const directoryReset = useConfigReset(
		"worktreeDirectory",
		"settings.workspaces.directoryChangeFailed",
	);
	const folderSupported =
		protocolVersion !== null && protocolVersion >= PROJECTS_FOLDER_PROTOCOL_VERSION;
	const directorySupported =
		protocolVersion !== null && protocolVersion >= WORKTREE_DIRECTORY_PROTOCOL_VERSION;

	const select = (choice: IdleChoice) => {
		const next = choice === "never" ? null : Number(choice);
		if (next === settleIdleDays) return;
		void saveSettings({ settleIdleDays: next }, t("settings.workspaces.changeFailed"));
	};

	return (
		<WorkspacesSettingsView
			settleIdleDays={settleIdleDays}
			supported={protocolVersion !== null && protocolVersion >= WORKSPACE_SETTLE_PROTOCOL_VERSION}
			reset={reset}
			onSelect={select}
			projectsFolder={
				folderSupported
					? {
							value: projectsFolder,
							reset: folderReset,
							onCommit: (next) =>
								saveSettings(
									{ projectsFolder: next },
									t("settings.workspaces.projectsFolder.changeFailed"),
								),
						}
					: null
			}
			worktreeDirectory={
				directorySupported
					? {
							value: worktreeDirectory ?? "",
							reset: directoryReset,
							onCommit: (next) =>
								saveSettings(
									{ worktreeDirectory: next },
									t("settings.workspaces.directoryChangeFailed"),
								),
							onPick: () =>
								getTransport()
									.request("dialog.selectDirectory", {})
									.then(({ path }) => path),
						}
					: null
			}
		/>
	);
}

function ProjectsFolderRow({ value, reset, onCommit }: ProjectsFolderField) {
	const t = useT();
	const errorId = useId();
	const { invalid, dirty, inputProps } = useSettingsDraft({
		saved: value,
		isValid: isProjectsFolder,
		normalize: (draft) => draft.trim(),
		commit: onCommit,
	});
	return (
		<SettingsRow
			{...settingProps(t, SETTING.projectsFolder)}
			reset={reset}
			control={
				<span className="flex flex-col items-end gap-2">
					<input
						type="text"
						spellCheck={false}
						autoComplete="off"
						{...inputProps}
						aria-label={t(SETTING.projectsFolder.label)}
						aria-describedby={invalid ? errorId : undefined}
						data-testid="projects-folder-input"
						data-setting-clean={dirty ? undefined : ""}
						className={cn(SETTINGS_INPUT, "w-240")}
					/>
					{invalid ? (
						<span id={errorId} className="text-feedback-error tr-text-metadata">
							{t("settings.workspaces.projectsFolder.invalid")}
						</span>
					) : null}
				</span>
			}
		/>
	);
}

function WorktreeDirectoryRow({ value, reset, onCommit, onPick }: WorktreeDirectoryField) {
	const t = useT();
	const errorId = useId();
	const { invalid, submit, inputProps } = useSettingsDraft({
		saved: value,
		isValid: isAbsolutePath,
		normalize: (draft) => draft.trim(),
		commit: (draft) => onCommit(draft.trim() || null),
	});
	return (
		<SettingsRow
			{...settingProps(t, SETTING.worktreeDirectory)}
			reset={reset}
			control={
				<span className="flex flex-col items-end gap-2">
					<span className="flex items-center gap-4">
						<input
							type="text"
							spellCheck={false}
							autoComplete="off"
							{...inputProps}
							aria-label={t(SETTING.worktreeDirectory.label)}
							aria-describedby={invalid ? errorId : undefined}
							data-testid="settings-worktree-directory"
							placeholder={t("settings.workspaces.directoryDefault")}
							className={cn(SETTINGS_INPUT, "w-240 tr-code-text")}
						/>
						<Button
							variant="outline"
							size="s"
							data-testid="settings-worktree-directory-browse"
							onClick={() =>
								void onPick().then((path) => {
									if (path) submit(path);
								})
							}
						>
							{t("settings.workspaces.directoryBrowse")}
						</Button>
					</span>
					{invalid ? (
						<span id={errorId} className="text-feedback-error tr-text-metadata">
							{t("settings.workspaces.directoryInvalid")}
						</span>
					) : null}
				</span>
			}
		/>
	);
}

export function WorkspacesSettingsView({
	settleIdleDays,
	supported,
	reset,
	onSelect,
	projectsFolder,
	worktreeDirectory,
}: {
	settleIdleDays: number | null;
	supported: boolean;
	reset: SettingsReset;
	onSelect: (choice: IdleChoice) => void;
	projectsFolder: ProjectsFolderField | null;
	worktreeDirectory: WorktreeDirectoryField | null;
}) {
	const t = useT();
	const [pending, setPending] = useState<IdleChoice | null>(null);
	const value = toChoice(settleIdleDays);
	const description = idleDescription(pending, value);
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
				{projectsFolder ? <ProjectsFolderRow {...projectsFolder} /> : null}
				{worktreeDirectory ? <WorktreeDirectoryRow {...worktreeDirectory} /> : null}
			</div>
		</SettingsPage>
	);
}
