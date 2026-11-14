import {
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	WORKTREE_DIRECTORY_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { toast, useAppStore } from "../store";
import { getTransport } from "../transport";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

type IdleChoice = `${number}` | "never";

type IdleChoiceSpec = Omit<SettingsRadioChoice<IdleChoice>, "label" | "hint" | "description"> & {
	days: number | null;
	hint?: MessageKey;
	description: MessageKey;
};

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
	const supported =
		protocolVersion !== null && protocolVersion >= WORKSPACE_SETTLE_PROTOCOL_VERSION;
	const directorySupported =
		protocolVersion !== null && protocolVersion >= WORKTREE_DIRECTORY_PROTOCOL_VERSION;

	const select = (choice: IdleChoice) => {
		const next = choice === "never" ? null : Number(choice);
		if (next === settleIdleDays) return;
		getTransport()
			.request("settings.update", { config: { settleIdleDays: next } })
			.catch(() => toast.error(t("settings.workspaces.changeFailed")));
	};

	const directoryDraft = useSettingsDraft({
		saved: worktreeDirectory ?? "",
		isValid: isAbsolutePath,
		commit: (draft) =>
			getTransport()
				.request("settings.update", { config: { worktreeDirectory: draft.trim() || null } })
				.then(() => true)
				.catch(() => {
					toast.error(t("settings.workspaces.changeFailed"));
					return false;
				}),
	});

	return (
		<section data-testid="settings-workspaces" className="flex flex-col gap-16">
			{directorySupported ? (
				<SettingsGroup
					title={t("settings.workspaces.directoryTitle")}
					description={t("settings.workspaces.directoryDescription")}
				>
					<div className="flex flex-col gap-8 px-12 py-12">
						<div className="flex min-w-0 gap-8">
							<input
								{...directoryDraft.inputProps}
								data-testid="settings-worktree-directory"
								placeholder={t("settings.workspaces.directoryDefault")}
								className={`${SETTINGS_INPUT} min-w-0 flex-1`}
							/>
							<button
								type="button"
								data-testid="settings-worktree-directory-browse"
								onClick={() =>
									getTransport()
										.request("dialog.selectDirectory", {})
										.then(({ path }) => {
											if (path) directoryDraft.submit(path);
										})
										.catch(() => toast.error(t("settings.workspaces.changeFailed")))
								}
								className="shrink-0 rounded-sm border border-control-border-default px-8 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
							>
								{t("settings.workspaces.directoryBrowse")}
							</button>
						</div>
						<button
							type="button"
							data-testid="settings-worktree-directory-reset"
							onClick={() => directoryDraft.submit("")}
							className="self-start tr-text-metadata text-text-muted hover:text-text-default"
						>
							{t("settings.workspaces.directoryReset")}
						</button>
					</div>
				</SettingsGroup>
			) : null}
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">{t("settings.workspaces.title")}</h3>
					<p className="text-text-muted tr-text-metadata">{t("settings.workspaces.description")}</p>
				</div>
				<SettingsRadioCards
					name="settle-idle-days"
					label={t("settings.workspaces.title")}
					choices={IDLE_CHOICES.map(({ days, hint, description, ...choice }) => ({
						...choice,
						label:
							days === null
								? t("settings.workspaces.idle.neverLabel")
								: t("settings.workspaces.idle.days", { count: days }),
						...(hint ? { hint: t(hint) } : {}),
						description: t(description),
					}))}
					value={toChoice(settleIdleDays)}
					disabled={!supported}
					onSelect={select}
				/>
			</div>
		</section>
	);
}
