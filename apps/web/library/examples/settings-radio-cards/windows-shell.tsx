import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRadioCards, type SettingsRadioChoice } from "@/panels/SettingsRadioCards";

type Shell = "auto" | "pwsh" | "powershell" | "cmd";

type ShellChoiceSpec = SettingsRadioChoice<Shell> & {
	label: MessageKey;
	hint?: MessageKey;
	description: MessageKey;
};

const SHELL_CHOICES: ShellChoiceSpec[] = [
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

export default function WindowsShell() {
	const t = useT();
	const [shell, setShell] = useState<Shell>("auto");
	return (
		<div className="flex w-full flex-col">
			<div className="flex flex-col gap-2 pb-8">
				<h3 className="tr-title-section text-text-default">{t("settings.terminal.shell.title")}</h3>
				<p className="tr-text-metadata text-text-muted">
					{t("settings.terminal.shell.description")}
				</p>
			</div>
			<SettingsRadioCards
				name="terminal-windows-shell"
				label={t("settings.terminal.shell.title")}
				choices={SHELL_CHOICES.map((choice) => ({
					...choice,
					label: t(choice.label),
					...(choice.hint ? { hint: t(choice.hint) } : {}),
					description: t(choice.description),
				}))}
				value={shell}
				onSelect={setShell}
			/>
		</div>
	);
}
