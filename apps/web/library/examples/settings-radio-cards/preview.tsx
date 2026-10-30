import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRadioCards } from "@/panels/SettingsRadioCards";

type Shell = "auto" | "pwsh" | "cmd";

export default function Preview() {
	const t = useT();
	const [shell, setShell] = useState<Shell>("auto");
	return (
		<div className="w-full">
			<SettingsRadioCards
				name="terminal-windows-shell-preview"
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
				onSelect={setShell}
			/>
		</div>
	);
}
