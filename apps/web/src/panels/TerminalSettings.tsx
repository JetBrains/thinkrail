import { RiCheckLine as Check } from "@remixicon/react";
import type { HostPlatform, TerminalWindowsShell } from "@thinkrail/contracts";
import { TERMINAL_REPLAY_KB, WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";

const REPLAY_CHOICES: { kb: number; label: string; hint: string }[] = [
	{ kb: 0, label: "Off", hint: "Reattaching shows an empty screen over the live shell" },
	{ kb: 16, label: "16 KB", hint: "About a screenful" },
	{ kb: TERMINAL_REPLAY_KB.default, label: "64 KB", hint: "A screenful plus scrollback (default)" },
	{ kb: 256, label: "256 KB", hint: "Long scrollback; more memory per terminal" },
	{ kb: TERMINAL_REPLAY_KB.max, label: "1 MB", hint: "Maximum" },
];

const WINDOWS_SHELL_CHOICES: SettingsRadioChoice<TerminalWindowsShell>[] = [
	{
		id: "auto",
		label: "Auto",
		hint: "Recommended",
		description: "PowerShell 7 (pwsh) when installed, otherwise Windows PowerShell.",
		testId: "terminal-shell-auto",
	},
	{
		id: "pwsh",
		label: "PowerShell 7",
		hint: "pwsh",
		description: "Always use pwsh. Requires it to be installed and on PATH.",
		testId: "terminal-shell-pwsh",
	},
	{
		id: "powershell",
		label: "Windows PowerShell",
		hint: "5.1",
		description: "Built into every Windows install.",
		testId: "terminal-shell-powershell",
	},
	{
		id: "cmd",
		label: "Command Prompt",
		hint: "cmd",
		description: "The classic default.",
		testId: "terminal-shell-cmd",
	},
];

/** Windows-only; props-driven so it stays testable under `renderToStaticMarkup` (see panels/SPEC.md). */
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
	if (
		platform !== "win32" ||
		protocolVersion === null ||
		protocolVersion < WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION
	) {
		return null;
	}
	return (
		<div className="flex flex-col gap-8 border-border-default border-t pt-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Windows shell</h3>
				<p className="text-text-muted tr-text-metadata">
					Which shell new terminal tabs start. Applies to terminals opened from now on.
				</p>
			</div>
			<SettingsRadioCards
				name="terminal-windows-shell"
				label="Windows shell"
				choices={WINDOWS_SHELL_CHOICES}
				value={value}
				onSelect={onSelect}
			/>
		</div>
	);
}

export function TerminalSettings() {
	const replayKb = useAppStore((s) => s.terminalReplayKb);
	const windowsShell = useAppStore((s) => s.terminalWindowsShell);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const protocolVersion = useAppStore((s) => s.protocolVersion);

	const select = (kb: number) => {
		if (kb === replayKb) return;
		getTransport()
			.request("settings.update", { config: { terminalReplayKb: kb } })
			.catch(() => toast.error("Couldn't change the replay size"));
	};

	const selectWindowsShell = (shell: TerminalWindowsShell) => {
		if (shell === windowsShell) return;
		getTransport()
			.request("settings.update", { config: { terminalWindowsShell: shell } })
			.catch(() => toast.error("Couldn't change the Windows shell"));
	};

	return (
		<section data-testid="settings-terminal" className="flex flex-col gap-16">
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Replayed output</h3>
					<p className="text-text-muted tr-text-metadata">
						A terminal keeps running when you leave it, but the view is rebuilt from scratch when
						you come back. This is how much of its recent output the host keeps so the screen is
						restored too. Applies to terminals opened from now on.
					</p>
				</div>
				<div className="flex flex-col gap-4">
					{REPLAY_CHOICES.map(({ kb, label, hint }) => {
						const active = kb === replayKb;
						return (
							<button
								key={kb}
								type="button"
								aria-pressed={active}
								data-testid={`terminal-replay-${kb}`}
								data-active={active}
								onClick={() => select(kb)}
								className={cn(
									"flex items-center gap-8 rounded-[var(--radius-sm)] border px-12 py-8 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
									active
										? "border-primary-muted bg-clip-padding bg-primary-subtle text-text-default"
										: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
								)}
							>
								<span className="flex-1">{label}</span>
								<span className="shrink-0 text-text-muted tr-text-metadata">{hint}</span>
								{active ? <Check className="size-16 shrink-0 text-primary" /> : null}
							</button>
						);
					})}
				</div>
			</div>

			<WindowsShellSettings
				platform={hostPlatform}
				protocolVersion={protocolVersion}
				value={windowsShell}
				onSelect={selectWindowsShell}
			/>
		</section>
	);
}
