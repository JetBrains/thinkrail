import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";
import { SettingsSwitch } from "@/panels/SettingsSwitch";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { Showcase } from "./types";

export type SwitchKind = "switch" | "settings-switch";

const muted = (text: string) => (
	<span key="note" className="tr-text-metadata text-text-muted">
		{text}
	</span>
);

export function Specimen({
	kind,
	initial,
	disabled = false,
}: {
	kind: SwitchKind;
	initial: boolean;
	disabled?: boolean;
}) {
	const [checked, setChecked] = useState(initial);
	const label = `${kind} ${initial ? "on" : "off"}${disabled ? " disabled" : ""}`;
	return kind === "switch" ? (
		<Switch checked={checked} disabled={disabled} label={label} onCheckedChange={setChecked} />
	) : (
		<SettingsSwitch
			checked={checked}
			disabled={disabled}
			label={label}
			testId={`showcase-${label.replaceAll(" ", "-")}`}
			onChange={setChecked}
		/>
	);
}

export function stateMatrix(kind: SwitchKind) {
	return function StateMatrix() {
		return (
			<Table
				head={["", "Off", "On"]}
				rows={[
					[
						muted(kind === "switch" ? "Enabled — hover, click, Tab" : "Enabled — click, Tab"),
						<Specimen key="off" kind={kind} initial={false} />,
						<Specimen key="on" kind={kind} initial />,
					],
					[
						muted("Disabled"),
						<Specimen key="off" kind={kind} initial={false} disabled />,
						<Specimen key="on" kind={kind} initial disabled />,
					],
				]}
			/>
		);
	};
}

const DIFFERENCES: readonly [string, string, string][] = [
	[
		"Hit area and hover",
		"The track sits in a larger round hit area that takes `control-bg-hovered` on hover.",
		"The button is the track itself; no hover treatment.",
	],
	[
		"Knob when on",
		"`control-primary-text`, the label colour on the primary fill.",
		"Stays `container-workspace-bg` in both states.",
	],
	[
		"Disabled",
		"Disabled colour roles: track `control-primary-disabled-bg` (on) or `control-disabled-border` (off), knob `control-disabled-text`.",
		"The enabled colours at `opacity-50`.",
	],
	[
		"Focus ring",
		"Drawn around the hit area, clear of the track.",
		"Drawn flush against the track; on the `primary` track it merges with the fill.",
	],
	[
		"Reduced motion",
		"Track and knob transitions stop under `prefers-reduced-motion`.",
		"Transitions always run.",
	],
	[
		"API",
		"`onCheckedChange`; optional `testId`; native button props, `className` and `ref` pass through; `onClick` can cancel with `preventDefault()`.",
		"`onChange`; required `testId`; nothing else is accepted.",
	],
];

export function Comparison() {
	return (
		<>
			<Table
				head={["", "Switch", "SettingsSwitch"]}
				rows={[
					[
						muted("Off"),
						<Specimen key="a" kind="switch" initial={false} />,
						<Specimen key="b" kind="settings-switch" initial={false} />,
					],
					[
						muted("On"),
						<Specimen key="a" kind="switch" initial />,
						<Specimen key="b" kind="settings-switch" initial />,
					],
					[
						muted("Disabled off"),
						<Specimen key="a" kind="switch" initial={false} disabled />,
						<Specimen key="b" kind="settings-switch" initial={false} disabled />,
					],
					[
						muted("Disabled on"),
						<Specimen key="a" kind="switch" initial disabled />,
						<Specimen key="b" kind="settings-switch" initial disabled />,
					],
				]}
			/>
			<Table
				head={["Aspect", "Switch", "SettingsSwitch"]}
				rows={DIFFERENCES.map(([aspect, ui, settings]) => [
					<span key="aspect" className="tr-text-emphasis">
						{aspect}
					</span>,
					<InlineMarkdown key="ui" source={ui} />,
					<InlineMarkdown key="settings" source={settings} />,
				])}
			/>
		</>
	);
}

export const COMPARISON_DESCRIPTION =
	'Both render a `role="switch"` button with the same track and knob geometry, but they are two implementations (audit F-04). Every cell is the real component: hover and Tab into each column to compare.';

export const switchShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Hover and click the first row, or click into the page and press Tab to see keyboard focus. Disabled is the real prop.",
			Render: stateMatrix("switch"),
		},
		{
			id: "compare",
			title: "Switch and SettingsSwitch",
			description: COMPARISON_DESCRIPTION,
			Render: Comparison,
		},
	],
};
