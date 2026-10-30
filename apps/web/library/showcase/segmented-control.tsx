import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { Table } from "../parts/Section";
import { SegmentComparison } from "./toggle-segment";
import type { PlaygroundConfig, PlaygroundValues, Showcase } from "./types";

type Growth = "compact" | "roomy" | "half-chat";

function useGrowthOptions() {
	const t = useT();
	return [
		{ id: "compact", label: t("settings.chat.growth.compact") },
		{ id: "roomy", label: t("settings.chat.growth.roomy") },
		{ id: "half-chat", label: t("settings.chat.growth.halfChat") },
	] as const;
}

function StateRow({
	name,
	initial,
	disabled = false,
	lastDisabled = false,
}: {
	name: string;
	initial: Growth | null;
	disabled?: boolean;
	lastDisabled?: boolean;
}) {
	const t = useT();
	const options = useGrowthOptions();
	const [value, setValue] = useState<Growth | null>(initial);
	return (
		<SegmentedControl
			name={name}
			label={t("settings.chat.composerSize")}
			options={options.map((option, index) => ({
				...option,
				disabled: lastDisabled && index === options.length - 1,
			}))}
			value={value}
			disabled={disabled}
			onSelect={setValue}
		/>
	);
}

const code = (text: string) => (
	<code key="name" className="tr-code-text">
		{text}
	</code>
);

function StateMatrix() {
	return (
		<Table
			head={["Props", "Live"]}
			rows={[
				[code('value="compact"'), <StateRow key="live" name="seg-state-rest" initial="compact" />],
				[code("value={null}"), <StateRow key="live" name="seg-state-null" initial={null} />],
				[
					code("option.disabled (last)"),
					<StateRow key="live" name="seg-state-option" initial="compact" lastDisabled />,
				],
				[code("disabled"), <StateRow key="live" name="seg-state-group" initial="roomy" disabled />],
			]}
		/>
	);
}

const OPTION_COUNTS = ["2", "3", "5"] as const;
const OPTION_KEYS = [
	"common.off",
	"settings.terminal.scrollback.kb16",
	"settings.terminal.scrollback.kb64",
	"settings.terminal.scrollback.kb256",
	"settings.terminal.scrollback.mb1",
] as const;
const OPTION_IDS = ["0", "16", "64", "256", "1024"] as const;

function playgroundOptions(values: PlaygroundValues) {
	const count = Number(values.options);
	return OPTION_IDS.slice(0, count).map((id, index) => ({
		id,
		key: OPTION_KEYS[index] ?? "common.off",
		disabled: values.lastOptionDisabled === true && index === count - 1,
	}));
}

function playgroundValue(values: PlaygroundValues, ids: readonly string[]) {
	if (values.value === "none") return null;
	return (values.value === "last" ? ids[ids.length - 1] : ids[0]) ?? null;
}

function PlaygroundPreview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const options = playgroundOptions(values);
	const [picked, setPicked] = useState<string | null>(null);
	const value =
		picked ??
		playgroundValue(
			values,
			options.map((option) => option.id),
		);
	return (
		<SegmentedControl
			name="seg-playground"
			label={t("settings.terminal.scrollback.label")}
			options={options.map((option) => ({
				id: option.id,
				label: t(option.key),
				disabled: option.disabled,
			}))}
			value={value}
			disabled={values.disabled === true}
			onSelect={setPicked}
		/>
	);
}

const playground: PlaygroundConfig = {
	controls: [
		{ kind: "choice", name: "options", options: OPTION_COUNTS },
		{ kind: "choice", name: "value", options: ["first", "last", "none"] },
		{ kind: "flag", name: "disabled" },
		{ kind: "flag", name: "lastOptionDisabled" },
	],
	initial: { options: "3", value: "first" },
	Preview: ({ values }) => (
		<PlaygroundPreview key={`${values.options}-${values.value}`} values={values} />
	),
	code: (values) => {
		const options = playgroundOptions(values);
		const value = playgroundValue(
			values,
			options.map((option) => option.id),
		);
		const lines = options.map(
			(option) =>
				`\t\t{ id: "${option.id}", label: t("${option.key}")${option.disabled ? ", disabled: true" : ""} },`,
		);
		return [
			"<SegmentedControl",
			'\tname="terminal-scrollback"',
			'\tlabel={t("settings.terminal.scrollback.label")}',
			"\toptions={[",
			...lines,
			"\t]}",
			value === null ? "\tvalue={null}" : `\tvalue="${value}"`,
			...(values.disabled === true ? ["\tdisabled"] : []),
			"\tonSelect={setReplayKb}",
			"/>",
		].join("\n");
	},
};

export const segmentedControlShowcase: Showcase = {
	sections: [
		{ id: "states", Render: StateMatrix },
		{ id: "compare", Render: SegmentComparison },
	],
	playground,
};
