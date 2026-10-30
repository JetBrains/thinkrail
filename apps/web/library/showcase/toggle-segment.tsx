import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { Table } from "../parts/Section";
import type { Showcase } from "./types";

function StateMatrix() {
	const t = useT();
	const cell = (active: boolean, disabled: boolean) => (
		<ToggleSegment
			testid={`toggle-segment-state-${active ? "active" : "inactive"}${disabled ? "-disabled" : ""}`}
			label={t("changes.panel.tree")}
			active={active}
			disabled={disabled}
			onClick={() => {}}
		/>
	);
	return (
		<Table
			head={["active", "Hover · Tab", "disabled"]}
			rows={[
				[
					<code key="name" className="tr-code-text">
						false
					</code>,
					cell(false, false),
					cell(false, true),
				],
				[
					<code key="name" className="tr-code-text">
						true
					</code>,
					cell(true, false),
					cell(true, true),
				],
			]}
		/>
	);
}

type View = "list" | "tree";

/** The same two-option choice rendered by both components, for the comparison sections. */
export function SegmentComparison() {
	const t = useT();
	const [view, setView] = useState<View>("list");
	const options = [
		{ id: "list", label: t("changes.panel.list") },
		{ id: "tree", label: t("changes.panel.tree") },
	] as const;
	return (
		<Table
			head={["Component", "Live", "Semantics and keyboard"]}
			rows={[
				[
					<span key="name" className="tr-text-emphasis">
						ToggleSegment
					</span>,
					<span key="live" className="flex items-center gap-4">
						{options.map((option) => (
							<ToggleSegment
								key={option.id}
								testid={`compare-toggle-${option.id}`}
								label={option.label}
								active={view === option.id}
								onClick={() => setView(option.id)}
							/>
						))}
					</span>,
					"Toggle buttons with aria-pressed; each is a Tab stop; Enter / Space.",
				],
				[
					<span key="name" className="tr-text-emphasis">
						SegmentedControl
					</span>,
					<SegmentedControl
						key="live"
						name="compare-segmented"
						label={t("changes.panel.toolbar")}
						options={options}
						value={view}
						onSelect={setView}
					/>,
					"A named radiogroup of native radios; one Tab stop; arrow keys select.",
				],
			]}
		/>
	);
}

export const toggleSegmentShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component with real props. Hover the enabled inactive segment, or click into the page and press Tab to see keyboard focus.",
			Render: StateMatrix,
		},
		{
			id: "compare",
			title: "ToggleSegment and SegmentedControl",
			description:
				"The same choice in both components, sharing one state. ToggleSegment is for view toggles in chrome; SegmentedControl is for settings.",
			Render: SegmentComparison,
		},
	],
};
