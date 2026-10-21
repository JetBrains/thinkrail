import type { HostPlatform, TerminalWindowsShell } from "@thinkrail/contracts";
import { WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SegmentedControl, type SegmentedControlOption } from "./SegmentedControl";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";
import { SETTINGS_ROWS_CONTAINER } from "./SettingsRow";

type ScrollbackOption = "0" | "16" | "64" | "256" | "1024";

const SCROLLBACK_OPTIONS: (SegmentedControlOption<ScrollbackOption> & { label: MessageKey })[] = [
	{ id: "0", label: "common.off", testId: "terminal-replay-0" },
	{ id: "16", label: "settings.terminal.scrollback.kb16", testId: "terminal-replay-16" },
	{ id: "64", label: "settings.terminal.scrollback.kb64", testId: "terminal-replay-64" },
	{ id: "256", label: "settings.terminal.scrollback.kb256", testId: "terminal-replay-256" },
	{ id: "1024", label: "settings.terminal.scrollback.mb1", testId: "terminal-replay-1024" },
];

type ShellChoiceSpec = SettingsRadioChoice<TerminalWindowsShell> & {
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
	onSelect,
}: {
	platform: HostPlatform | null;
	protocolVersion: number | null;
	value: TerminalWindowsShell;
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
		<div className="pt-24">
			<div className="flex flex-col">
				<div className="flex flex-col gap-2 pb-8">
					<h3 className="tr-title-section text-text-default">
						{t("settings.terminal.shell.title")}
					</h3>
					<p className="tr-text-metadata text-text-muted">
						{t("settings.terminal.shell.description")}
					</p>
				</div>
				<SettingsRadioCards
					name="terminal-windows-shell"
					label={t("settings.terminal.shell.title")}
					choices={WINDOWS_SHELL_CHOICES.map((choice) => ({
						...choice,
						label: t(choice.label),
						...(choice.hint ? { hint: t(choice.hint) } : {}),
						description: t(choice.description),
					}))}
					value={value}
					onSelect={onSelect}
				/>
			</div>
		</div>
	);
}

export function TerminalSettings() {
	const t = useT();
	const replayKb = useAppStore((s) => s.terminalReplayKb);
	const windowsShell = useAppStore((s) => s.terminalWindowsShell);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const protocolVersion = useAppStore((s) => s.protocolVersion);

	const select = (kb: number) => {
		if (kb === replayKb) return;
		getTransport()
			.request("settings.update", { config: { terminalReplayKb: kb } })
			.catch(() => toast.error(t("settings.terminal.replayFailed")));
	};

	const selectWindowsShell = (shell: TerminalWindowsShell) => {
		if (shell === windowsShell) return;
		getTransport()
			.request("settings.update", { config: { terminalWindowsShell: shell } })
			.catch(() => toast.error(t("settings.terminal.shellFailed")));
	};

	const scrollbackValue =
		SCROLLBACK_OPTIONS.find((option) => Number(option.id) === replayKb)?.id ?? null;

	return (
		<div data-testid="settings-terminal" className={SETTINGS_ROWS_CONTAINER}>
			<div className="flex flex-col gap-12 py-12">
				<div className="flex flex-col gap-2">
					<span className="tr-text-ui text-text-default">
						{t("settings.terminal.scrollback.title")}
					</span>
					<span className="tr-text-metadata text-text-muted">
						{t("settings.terminal.scrollback.description")}
					</span>
				</div>
				<SegmentedControl
					name="terminal-scrollback"
					label={t("settings.terminal.scrollback.label")}
					options={SCROLLBACK_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
					value={scrollbackValue}
					onSelect={(id) => select(Number(id))}
					testId="terminal-scrollback-control"
				/>
			</div>

			<WindowsShellSettings
				platform={hostPlatform}
				protocolVersion={protocolVersion}
				value={windowsShell}
				onSelect={selectWindowsShell}
			/>
		</div>
	);
}
