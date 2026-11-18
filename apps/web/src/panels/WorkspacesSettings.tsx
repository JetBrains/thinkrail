import { WORKSPACE_SETTLE_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import {
	SETTINGS_ROWS,
	SettingsChoice,
	SettingsPage,
	type SettingsReset,
	SettingsRow,
} from "@/settingsKit";
import { useAppStore } from "@/store";
import { saveSettings } from "./saveSettings";
import { useConfigReset } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

export type IdleChoice = `${number}` | "never";

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

export function WorkspacesSettings() {
	const t = useT();
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const reset = useConfigReset("settleIdleDays", "settings.workspaces.changeFailed");

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
		/>
	);
}

export function WorkspacesSettingsView({
	settleIdleDays,
	supported,
	reset,
	onSelect,
}: {
	settleIdleDays: number | null;
	supported: boolean;
	reset: SettingsReset;
	onSelect: (choice: IdleChoice) => void;
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
			</div>
		</SettingsPage>
	);
}
