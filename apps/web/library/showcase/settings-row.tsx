import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { SettingsGroup, SettingsPageContainer } from "@/panels/SettingsGroup";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";
import { Table } from "../parts/Section";
import type { PlaygroundConfig, PlaygroundValues, Showcase } from "./types";

type Growth = "compact" | "roomy" | "half-chat";

const code = (text: string) => (
	<code key="name" className="tr-code-text">
		{text}
	</code>
);

function GrowthRow({ name }: { name: string }) {
	const t = useT();
	const [growth, setGrowth] = useState<Growth>("roomy");
	return (
		<SettingsRow
			label={t("settings.chat.composerSize")}
			description={t("settings.chat.composerSizeDescription")}
			control={
				<SegmentedControl
					name={name}
					label={t("settings.chat.composerSize")}
					options={[
						{ id: "compact", label: t("settings.chat.growth.compact") },
						{ id: "roomy", label: t("settings.chat.growth.roomy") },
						{ id: "half-chat", label: t("settings.chat.growth.halfChat") },
					]}
					value={growth}
					onSelect={setGrowth}
				/>
			}
		/>
	);
}

function Widths() {
	return (
		<Table
			head={["Column", "Live"]}
			rows={[
				[
					code("max-w-[40rem]"),
					<div key="live" className="w-full max-w-[40rem]">
						<GrowthRow name="srw-width-wide" />
					</div>,
				],
				[
					code("max-w-[24rem]"),
					<div key="live" className="w-full max-w-[24rem]">
						<GrowthRow name="srw-width-medium" />
					</div>,
				],
				[
					code("max-w-[16rem]"),
					<div key="live" className="w-full max-w-[16rem]">
						<GrowthRow name="srw-width-narrow" />
					</div>,
				],
			]}
		/>
	);
}

function Dividers() {
	const t = useT();
	const [agentReview, setAgentReview] = useState(true);
	const [autoFix, setAutoFix] = useState(false);
	const rows = (
		<>
			<SettingsRow
				label={t("settings.models.agentReview")}
				control={
					<SettingsSwitch
						checked={agentReview}
						label={t("settings.models.agentReview")}
						testId="srw-divider-review"
						onChange={setAgentReview}
					/>
				}
			/>
			<SettingsRow
				label={t("settings.models.autoFix")}
				control={
					<SettingsSwitch
						checked={autoFix}
						label={t("settings.models.autoFix")}
						testId="srw-divider-autofix"
						onChange={setAutoFix}
					/>
				}
			/>
		</>
	);
	return (
		<Table
			head={["Wrapper", "Live"]}
			rows={[
				[
					code("<div>"),
					<div key="live" className="w-full max-w-[28rem]">
						{rows}
					</div>,
				],
				[
					code("SETTINGS_ROWS_CONTAINER"),
					<div key="live" className="w-full max-w-[28rem]">
						<div className={SETTINGS_ROWS_CONTAINER}>{rows}</div>
					</div>,
				],
				[
					code("<SettingsPageContainer>"),
					<div key="live" className="w-full max-w-[28rem]">
						<SettingsPageContainer>
							<SettingsGroup key="review" title={t("settings.models.reviewGroup")}>
								{rows}
							</SettingsGroup>
							<SkippedGroup key="skipped" />
							<SettingsGroup key="chat" title={t("settings.chat.group")}>
								<GrowthRow name="srw-divider-growth" />
							</SettingsGroup>
						</SettingsPageContainer>
					</div>,
				],
			]}
		/>
	);
}

function SkippedGroup() {
	return null;
}

type ControlKind = "switch" | "segmented" | "button";

const ROW_TEXT = {
	switch: {
		label: "settings.models.autoFix",
		description: "settings.models.autoFixDescription",
	},
	segmented: {
		label: "settings.chat.composerSize",
		description: "settings.chat.composerSizeDescription",
	},
	button: {
		label: "workbench.layoutSettings.resetToDefault",
		description: "workbench.layoutSettings.resetDescription",
	},
} as const satisfies Record<ControlKind, { label: MessageKey; description: MessageKey }>;

function PlaygroundPreview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const [checked, setChecked] = useState(true);
	const [growth, setGrowth] = useState<Growth>("roomy");
	const kind = values.control as ControlKind;
	const label = t(ROW_TEXT[kind].label);
	const control =
		kind === "switch" ? (
			<SettingsSwitch
				checked={checked}
				label={label}
				testId="srw-playground-switch"
				onChange={setChecked}
			/>
		) : kind === "segmented" ? (
			<SegmentedControl
				name="srw-playground-growth"
				label={label}
				options={[
					{ id: "compact", label: t("settings.chat.growth.compact") },
					{ id: "roomy", label: t("settings.chat.growth.roomy") },
					{ id: "half-chat", label: t("settings.chat.growth.halfChat") },
				]}
				value={growth}
				onSelect={setGrowth}
			/>
		) : (
			<Button variant="outline" size="m" onClick={() => {}}>
				{t("workbench.layoutSettings.reset")}
			</Button>
		);
	return (
		<div className={values.width === "narrow" ? "w-full max-w-[16rem]" : "w-full max-w-[32rem]"}>
			<SettingsRow
				label={label}
				{...(values.description === true
					? {
							description: t(ROW_TEXT[kind].description, {
								name: t("workbench.preset.balanced"),
							}),
						}
					: {})}
				noBorder={values.noBorder === true}
				control={control}
			/>
		</div>
	);
}

const CONTROL_CODE: Record<ControlKind, string[]> = {
	switch: [
		"\t\t<SettingsSwitch",
		"\t\t\tchecked={autoFix}",
		'\t\t\tlabel={t("settings.models.autoFix")}',
		'\t\t\ttestId="review-autofix-toggle"',
		"\t\t\tonChange={setAutoFix}",
		"\t\t/>",
	],
	segmented: [
		"\t\t<SegmentedControl",
		'\t\t\tname="composer-growth-limit"',
		'\t\t\tlabel={t("settings.chat.composerSize")}',
		"\t\t\toptions={growthOptions}",
		"\t\t\tvalue={growth}",
		"\t\t\tonSelect={setGrowth}",
		"\t\t/>",
	],
	button: [
		'\t\t<Button variant="outline" size="m" onClick={confirmReset}>',
		'\t\t\t{t("workbench.layoutSettings.reset")}',
		"\t\t</Button>",
	],
};

function descriptionCode(kind: ControlKind) {
	return kind === "button"
		? `\tdescription={t("${ROW_TEXT.button.description}", { name: presetName })}`
		: `\tdescription={t("${ROW_TEXT[kind].description}")}`;
}

const playground: PlaygroundConfig = {
	controls: [
		{ kind: "choice", name: "control", options: ["switch", "segmented", "button"] },
		{ kind: "choice", name: "width", options: ["wide", "narrow"] },
		{ kind: "flag", name: "description" },
		{ kind: "flag", name: "noBorder" },
	],
	initial: { control: "switch", width: "wide", description: true },
	Preview: ({ values }) => <PlaygroundPreview key={String(values.control)} values={values} />,
	code: (values) => {
		const kind = values.control as ControlKind;
		return [
			"<SettingsRow",
			`\tlabel={t("${ROW_TEXT[kind].label}")}`,
			...(values.description === true ? [descriptionCode(kind)] : []),
			...(values.noBorder === true ? ["\tnoBorder"] : []),
			"\tcontrol={",
			...CONTROL_CODE[kind],
			"\t}",
			"/>",
		].join("\n");
	},
};

export const settingsRowShowcase: Showcase = {
	sections: [
		{
			id: "widths",
			title: "Narrow columns",
			description:
				"The same real row in three column widths. The label column keeps a minimum width (`min-w-160`); when the control no longer fits beside it, the control wraps below the label instead of squeezing it.",
			Render: Widths,
		},
		{
			id: "dividers",
			title: "Dividers",
			description:
				"Every row draws its own bottom divider. A bare wrapper keeps the last one; `SETTINGS_ROWS_CONTAINER` (also inside every `SettingsGroup`) drops it; `SettingsPageContainer` adds a rule and spacing only between children that render — the middle child here renders `null` and leaves no extra rule.",
			Render: Dividers,
		},
	],
	playground,
};
