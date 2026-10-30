import { RiParagraph } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useState } from "react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";
import { Table } from "../parts/Section";
import type { Showcase } from "./types";

const code = (text: string) => (
	<code key="code" className="tr-code-text">
		{text}
	</code>
);

type Active = "omitted" | "false" | "true";
const ACTIVE: readonly Active[] = ["omitted", "false", "true"];

function StateMatrix() {
	const t = useT();
	const cell = (active: Active, disabled: boolean) => (
		<HeaderIconButton
			testid={`header-icon-button-state-${active}${disabled ? "-disabled" : ""}`}
			label={t("panels.diffPane.hideWhitespace")}
			{...(active === "omitted" ? {} : { active: active === "true" })}
			disabled={disabled}
			onClick={() => {}}
			icon={RiParagraph}
		/>
	);
	return (
		<Table
			head={["active", "Hover · press · Tab", "disabled"]}
			rows={ACTIVE.map((active) => [
				code(active === "omitted" ? "(omitted)" : active),
				cell(active, false),
				cell(active, true),
			])}
		/>
	);
}

function Comparison() {
	const t = useT();
	const [on, setOn] = useState(false);
	const label = t("panels.diffPane.hideWhitespace");
	return (
		<Table
			head={["Component", "Live"]}
			rows={[
				[
					<span key="name" className="tr-text-emphasis">
						HeaderIconButton
					</span>,
					<HeaderIconButton
						key="live"
						testid="header-icon-button-compare"
						label={label}
						active={on}
						onClick={() => setOn(!on)}
						icon={RiParagraph}
					/>,
				],
				[
					<span key="name" className="tr-text-emphasis">
						IconButton
					</span>,
					<IconButton
						key="live"
						icon={RiParagraph}
						label={label}
						variant="ghost"
						size="m"
						selected={on}
						data-testid="icon-button-compare"
						data-active={on}
						aria-pressed={on}
						onClick={() => setOn(!on)}
					/>,
				],
			]}
		/>
	);
}

export const headerIconButtonShowcase: Showcase = {
	sections: [
		{ id: "compared", Render: Comparison },
		{ id: "states", Render: StateMatrix },
	],
};
