import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";
import { SettingsSwitch } from "@/panels/SettingsSwitch";
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
						muted("Enabled"),
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

export function Comparison() {
	return (
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
	);
}

export const switchShowcase: Showcase = {
	sections: [
		{ id: "states", Render: stateMatrix("switch") },
		{ id: "compare", Render: Comparison },
	],
};
