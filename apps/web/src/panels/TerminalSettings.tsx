import type { HostPlatform, TerminalWindowsShell } from "@thinkrail/contracts";
import { WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import {
	SETTINGS_ROWS,
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsGroup,
	SettingsPage,
	type SettingsReset,
	SettingsRow,
} from "@/settingsKit";
import { useAppStore } from "@/store";
import { saveSettings } from "./saveSettings";
import { useConfigReset } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

type ScrollbackOption = "0" | "16" | "64" | "256" | "1024";

const SCROLLBACK_OPTIONS: (SettingsChoiceOption<ScrollbackOption> & { label: MessageKey })[] = [
	{ id: "0", label: "common.off", testId: "terminal-replay-0" },
	{ id: "16", label: "settings.terminal.scrollback.kb16", testId: "terminal-replay-16" },
	{ id: "64", label: "settings.terminal.scrollback.kb64", testId: "terminal-replay-64" },
	{ id: "256", label: "settings.terminal.scrollback.kb256", testId: "terminal-replay-256" },
	{ id: "1024", label: "settings.terminal.scrollback.mb1", testId: "terminal-replay-1024" },
];

type ShellChoiceSpec = SettingsChoiceOption<TerminalWindowsShell> & {
	label: MessageKey;
	hint?: MessageKey;
	description: MessageKey;
};

const WINDOWS_SHELL_CHOICES: ShellChoiceSpec[] = [
	{
		id: "auto",
		label: "settings.terminal.shell.auto.label",
		hint: "settings.terminal.shell.auto.hint",
		description: "settings.terminal.shell.auto.description",
		testId: "terminal-shell-auto",
	},
	{
		id: "pwsh",
		label: "settings.terminal.shell.pwsh.label",
		description: "settings.terminal.shell.pwsh.description",
		testId: "terminal-shell-pwsh",
	},
	{
		id: "powershell",
		label: "settings.terminal.shell.powershell.label",
		description: "settings.terminal.shell.powershell.description",
		testId: "terminal-shell-powershell",
	},
	{
		id: "cmd",
		label: "settings.terminal.shell.cmd.label",
		description: "settings.terminal.shell.cmd.description",
		testId: "terminal-shell-cmd",
	},
];

export function WindowsShellSettings({
	platform,
	protocolVersion,
	value,
	reset,
	onSelect,
}: {
	platform: HostPlatform | null;
	protocolVersion: number | null;
	value: TerminalWindowsShell;
	reset?: SettingsReset | undefined;
	onSelect: (shell: TerminalWindowsShell) => void;
}) {
	const t = useT();
	if (
		platform !== "win32" ||
		protocolVersion === null ||
		protocolVersion < WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION
	) {
		return null;
	}
	return (
		<SettingsGroup title={t("settings.terminal.shell.title")} scope="device">
			<SettingsRow
				{...settingProps(t, SETTING.windowsShell)}
				reset={reset}
				layout="stacked"
				control={
					<SettingsChoice
						label={t("settings.terminal.shell.title")}
						layout="list"
						cost="expensive"
						options={WINDOWS_SHELL_CHOICES.map((choice) => ({
							...choice,
							label: t(choice.label),
							...(choice.hint ? { hint: t(choice.hint) } : {}),
							description: t(choice.description),
						}))}
						value={value}
						onSelect={onSelect}
						testId="terminal-shell-control"
					/>
				}
			/>
		</SettingsGroup>
	);
}

export function TerminalSettings() {
	const t = useT();
	const replayKb = useAppStore((s) => s.terminalReplayKb);
	const windowsShell = useAppStore((s) => s.terminalWindowsShell);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const replayReset = useConfigReset("terminalReplayKb", "settings.terminal.replayFailed");
	const shellReset = useConfigReset("terminalWindowsShell", "settings.terminal.shellFailed");

	const select = (kb: number) => {
		if (kb === replayKb) return;
		void saveSettings({ terminalReplayKb: kb }, t("settings.terminal.replayFailed"));
	};

	const selectWindowsShell = (shell: TerminalWindowsShell) => {
		if (shell === windowsShell) return;
		void saveSettings({ terminalWindowsShell: shell }, t("settings.terminal.shellFailed"));
	};

	const scrollbackValue =
		SCROLLBACK_OPTIONS.find((option) => Number(option.id) === replayKb)?.id ?? null;

	return (
		<SettingsPage
			title={t("settings.nav.terminal")}
			description={t("settings.terminal.description")}
			testId="settings-terminal"
		>
			<div className={SETTINGS_ROWS}>
				<SettingsRow
					{...settingProps(t, SETTING.scrollback)}
					control={
						<SettingsChoice
							label={t("settings.terminal.scrollback.label")}
							options={SCROLLBACK_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
							value={scrollbackValue}
							cost="cheap"
							onSelect={(id) => select(Number(id))}
							testId="terminal-scrollback-control"
						/>
					}
					reset={replayReset}
				/>
			</div>
			<WindowsShellSettings
				platform={hostPlatform}
				protocolVersion={protocolVersion}
				value={windowsShell}
				reset={shellReset}
				onSelect={selectWindowsShell}
			/>
		</SettingsPage>
	);
}
