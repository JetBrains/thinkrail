import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRadioCards, type SettingsRadioChoice } from "@/panels/SettingsRadioCards";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

type Shell = "auto" | "pwsh" | "cmd";

function useShellChoices(options: { hint?: boolean; disabled?: Shell } = {}) {
	const t = useT();
	const choices: SettingsRadioChoice<Shell>[] = [
		{
			id: "auto",
			label: t("settings.terminal.shell.auto.label"),
			...(options.hint === false ? {} : { hint: t("settings.terminal.shell.auto.hint") }),
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
	];
	return choices.map((choice) =>
		choice.id === options.disabled ? { ...choice, disabled: true } : choice,
	);
}

interface Cell {
	id: string;
	state: string;
	props: string;
	value: Shell | "none";
	disabled?: boolean;
	disabledChoice?: Shell;
}

const CELLS: readonly Cell[] = [
	{
		id: "selected",
		state: "Selected, rest — hover the others, Tab and arrows for focus",
		props: '`value="auto"`',
		value: "auto",
	},
	{
		id: "none",
		state: "No selection",
		props: "`value` matches no choice",
		value: "none",
	},
	{
		id: "disabled-choice",
		state: "Disabled choice",
		props: "`disabled` on PowerShell 7",
		value: "auto",
		disabledChoice: "pwsh",
	},
	{
		id: "selected-disabled",
		state: "Selected and disabled",
		props: '`value="pwsh"`, `disabled` on PowerShell 7',
		value: "pwsh",
		disabledChoice: "pwsh",
	},
	{
		id: "group-disabled",
		state: "Disabled group",
		props: "`disabled`",
		value: "auto",
		disabled: true,
	},
];

function Specimen({ cell }: { cell: Cell }) {
	const t = useT();
	const choices = useShellChoices(cell.disabledChoice ? { disabled: cell.disabledChoice } : {});
	const [value, setValue] = useState<string>(cell.value);
	return (
		<SettingsRadioCards<string>
			name={`library-src-state-${cell.id}`}
			label={t("settings.terminal.shell.title")}
			choices={choices}
			value={value}
			disabled={cell.disabled === true}
			onSelect={setValue}
		/>
	);
}

function StateMatrix() {
	return (
		<Table
			head={["State", "Props", "Live"]}
			rows={CELLS.map((cell) => [
				<span key="state" className="tr-text-emphasis">
					{cell.state}
				</span>,
				<InlineMarkdown key="props" source={cell.props} />,
				<div key="live" className="w-[22rem]">
					<Specimen cell={cell} />
				</div>,
			])}
		/>
	);
}

function Field({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const choices = useShellChoices({
		hint: values.hint === true,
		...(values.disabledChoice === true ? { disabled: "pwsh" as const } : {}),
	});
	const [value, setValue] = useState<string>(String(values.value));
	return (
		<div className="w-full max-w-[24rem]">
			<SettingsRadioCards<string>
				name="library-src-playground"
				label={t("settings.terminal.shell.title")}
				choices={choices}
				value={value}
				disabled={values.disabled === true}
				onSelect={setValue}
			/>
		</div>
	);
}

function Preview({ values }: { values: PlaygroundValues }) {
	return <Field key={String(values.value)} values={values} />;
}

function playgroundCode(values: PlaygroundValues) {
	const choice = (id: Shell, extra: string[] = []) =>
		[
			"\t\t{",
			`\t\t\tid: "${id}",`,
			`\t\t\tlabel: t("settings.terminal.shell.${id}.label"),`,
			...extra,
			`\t\t\tdescription: t("settings.terminal.shell.${id}.description"),`,
			`\t\t\ttestId: "terminal-shell-${id}",`,
			"\t\t},",
		].join("\n");
	const choices = [
		choice(
			"auto",
			values.hint === true ? ['\t\t\thint: t("settings.terminal.shell.auto.hint"),'] : [],
		),
		choice("pwsh", values.disabledChoice === true ? ["\t\t\tdisabled: true,"] : []),
		choice("cmd"),
	].join("\n");
	const value = values.value === "none" ? "value={shell} // matches no choice" : "value={shell}";
	return [
		`const [shell, setShell] = useState("${values.value}");`,
		"",
		"<SettingsRadioCards",
		'\tname="terminal-windows-shell"',
		'\tlabel={t("settings.terminal.shell.title")}',
		"\tchoices={[",
		choices,
		"\t]}",
		`\t${value}`,
		...(values.disabled === true ? ["\tdisabled"] : []),
		"\tonSelect={setShell}",
		"/>",
	].join("\n");
}

export const settingsRadioCardsShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component with real props and its own radio group. Hover a card, click to select, or click into the page and press Tab, then the arrow keys.",
			Render: StateMatrix,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "value", options: ["auto", "pwsh", "cmd", "none"] },
			{ kind: "flag", name: "hint" },
			{ kind: "flag", name: "disabledChoice" },
			{ kind: "flag", name: "disabled" },
		],
		initial: { value: "auto", hint: true },
		Preview,
		code: playgroundCode,
	},
};
