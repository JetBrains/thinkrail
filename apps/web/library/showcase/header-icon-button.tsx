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

const muted = (text: string) => (
	<span key="text" className="tr-text-metadata text-text-muted">
		{text}
	</span>
);

type Active = "omitted" | "false" | "true";
const ACTIVE: readonly Active[] = ["omitted", "false", "true"];
const PRESSED: Record<Active, string> = { omitted: "absent", false: '"false"', true: '"true"' };

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
			head={["active", "Hover · press · Tab", "disabled", "aria-pressed · data-active"]}
			rows={ACTIVE.map((active) => [
				code(active === "omitted" ? "(omitted)" : active),
				cell(active, false),
				cell(active, true),
				code(PRESSED[active]),
			])}
		/>
	);
}

function Comparison() {
	const t = useT();
	const [on, setOn] = useState(false);
	const label = t("panels.diffPane.hideWhitespace");
	return (
		<>
			<Table
				head={["Component", "Live", "Source"]}
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
						code('<HeaderIconButton testid="…" label={…} active={on} onClick={…} icon={…} />'),
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
						code(
							'<IconButton variant="ghost" size="m" selected={on} aria-pressed={on} data-active={on} data-testid="…" … />',
						),
					],
				]}
			/>
			<Table
				head={["HeaderIconButton", "Passed to IconButton as", "Note"]}
				rows={[
					[code("icon"), code("icon"), muted("Same.")],
					[code("label"), code("label"), muted("aria-label and tooltip; same.")],
					[code("testid"), code("data-testid"), muted("Required here; optional on IconButton.")],
					[
						code("active"),
						code("selected={active === true} aria-pressed={active} data-active={active}"),
						muted("One prop for the whole toggle contract."),
					],
					[code("disabled"), code("disabled"), muted("Same.")],
					[code("onClick"), code("onClick"), muted("Typed () => void; no event.")],
					[
						muted("(fixed)"),
						code('variant="ghost" size="m"'),
						muted("IconButton's own defaults, pinned."),
					],
					[
						muted("(not exposed)"),
						code(
							"tooltip, tooltipSide, tooltipAlign, wrapTrigger, loading, spinIcon, tone, className, ref, type, other native attributes",
						),
						muted("Rest props are not forwarded, so it cannot be a Radix asChild trigger."),
					],
				]}
			/>
		</>
	);
}

export const headerIconButtonShowcase: Showcase = {
	sections: [
		{
			id: "compared",
			title: "Compared with IconButton",
			description:
				"HeaderIconButton renders the shared IconButton and adds no styling of its own. Both rows below are live and render the same button.",
			Render: Comparison,
		},
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Hover and press the first column, or click into the page and press Tab to see keyboard focus; hover a disabled cell to see its tooltip.",
			Render: StateMatrix,
		},
	],
};
