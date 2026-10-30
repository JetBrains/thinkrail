import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRadioCards } from "@/panels/SettingsRadioCards";

type Shell = "auto" | "pwsh" | "cmd";

// Stands in for getTransport().request("settings.update", …) and the settings.changed broadcast.
function requestUpdate(shell: Shell, onChanged: (shell: Shell) => void) {
	setTimeout(() => onChanged(shell), 800);
}

export default function HostConfirmed() {
	const t = useT();
	// In the app this value comes from the store, which only the broadcast updates.
	const [shell, setShell] = useState<Shell>("auto");
	const select = (next: Shell) => {
		if (next === shell) return;
		requestUpdate(next, setShell);
	};
	return (
		<div className="w-full">
			<SettingsRadioCards
				name="terminal-windows-shell-confirmed"
				label={t("settings.terminal.shell.title")}
				choices={[
					{
						id: "auto",
						label: t("settings.terminal.shell.auto.label"),
						hint: t("settings.terminal.shell.auto.hint"),
						description: t("settings.terminal.shell.auto.description"),
						testId: "terminal-shell-auto",
					},
					{
						id: "pwsh",
						label: t("settings.terminal.shell.pwsh.label"),
						description: t("settings.terminal.shell.pwsh.description"),
						testId: "terminal-shell-pwsh",
					},
					{
						id: "cmd",
						label: t("settings.terminal.shell.cmd.label"),
						description: t("settings.terminal.shell.cmd.description"),
						testId: "terminal-shell-cmd",
					},
				]}
				value={shell}
				onSelect={select}
			/>
		</div>
	);
}
