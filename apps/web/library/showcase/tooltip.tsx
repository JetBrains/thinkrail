import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { IconTooltip, Tooltip, TooltipContent, TooltipTrigger } from "@thinkrail/ui/tooltip";
import { type ReactNode, type Ref, useRef, useState } from "react";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
const ALIGNS: readonly Align[] = ["start", "center", "end"];
const muted = "tr-text-metadata text-text-muted";

function WithIconTooltip({ ref }: { ref?: Ref<HTMLButtonElement> }) {
	const t = useT();
	return (
		<IconTooltip label={t("review.panel.clearTooltip")}>
			<Button {...(ref ? { ref } : {})} variant="outline" size="m">
				{t("review.panel.clear")}
			</Button>
		</IconTooltip>
	);
}

function WithParts({ ref }: { ref?: Ref<HTMLButtonElement> }) {
	const t = useT();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button {...(ref ? { ref } : {})} variant="outline" size="m">
					{t("review.panel.clear")}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{t("review.panel.clearTooltip")}</TooltipContent>
		</Tooltip>
	);
}

function FocusFromClick({
	Target,
}: {
	Target: (props: { ref?: Ref<HTMLButtonElement> }) => ReactNode;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	return (
		<span className="flex items-center gap-8">
			<Button variant="ghost" size="m" onClick={() => ref.current?.focus()}>
				Focus →
			</Button>
			<Target ref={ref} />
		</span>
	);
}

function DisabledTrigger({ wrap }: { wrap: boolean }) {
	const t = useT();
	return (
		<IconTooltip label={t("chat.skills.reloadBusy")} wrapTrigger={wrap}>
			<Button variant="outline" size="m" disabled>
				{t("chat.skills.reload")}
			</Button>
		</IconTooltip>
	);
}

function Behaviour() {
	return (
		<>
			<Table
				head={["Interaction", "IconTooltip", "Radix parts only"]}
				rows={[
					[
						"Hover, or click into the page and press Tab",
						<WithIconTooltip key="icon" />,
						<WithParts key="parts" />,
					],
					[
						"Click Focus: the target is focused from code after a pointer action, as when a dialog autofocuses",
						<FocusFromClick key="icon" Target={WithIconTooltip} />,
						<FocusFromClick key="parts" Target={WithParts} />,
					],
					[
						"Outcome",
						<span key="icon" className={muted}>
							Opens on hover and Tab; stays closed on focus from code
						</span>,
						<span key="parts" className={muted}>
							Opens on any focus, so it would cover a dialog and take its Escape
						</span>,
					],
				]}
			/>
			<Table
				head={["Disabled trigger", "wrapTrigger", "no wrapTrigger"]}
				rows={[
					[
						"Hover the disabled button",
						<DisabledTrigger key="wrap" wrap />,
						<DisabledTrigger key="bare" wrap={false} />,
					],
				]}
			/>
		</>
	);
}

function PlaygroundPreview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const [checked, setChecked] = useState(true);
	const hint = checked ? t("chat.skills.switchOn") : t("chat.skills.switchOff");
	const label =
		values.label === "structured" ? (
			<span>
				{t("chat.skills.title")}
				<br />
				{hint}
			</span>
		) : (
			hint
		);
	return (
		<IconTooltip
			label={label}
			side={values.side as Side}
			align={values.align as Align}
			wrapTrigger={values.wrapTrigger === true}
		>
			<Switch
				checked={checked}
				disabled={values.disabled === true}
				label="code-review"
				onCheckedChange={setChecked}
			/>
		</IconTooltip>
	);
}

function playgroundCode(values: PlaygroundValues) {
	const attrs = [
		values.label === "structured"
			? 'label={\n\t\t<span>\n\t\t\t{t("chat.skills.title")}\n\t\t\t<br />\n\t\t\t{hint}\n\t\t</span>\n\t}'
			: "label={hint}",
		values.side === "top" ? null : `side="${values.side}"`,
		values.align === "center" ? null : `align="${values.align}"`,
		values.wrapTrigger === true ? "wrapTrigger" : null,
	].filter((attr): attr is string => attr !== null);
	const switchAttrs = [
		"checked={checked}",
		values.disabled === true ? "disabled" : null,
		'label="code-review"',
		"onCheckedChange={setChecked}",
	].filter((attr): attr is string => attr !== null);
	return [
		"const hint = checked",
		'\t? t("chat.skills.switchOn")',
		'\t: t("chat.skills.switchOff");',
		"",
		`<IconTooltip\n\t${attrs.join("\n\t")}\n>`,
		`\t<Switch\n\t\t${switchAttrs.join("\n\t\t")}\n\t/>`,
		"</IconTooltip>",
	].join("\n");
}

export const tooltipShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every trigger is the real component. The left column is IconTooltip; the right composes the Radix parts directly, without its focus-visible gate. Disabled buttons need `wrapTrigger` to receive the pointer.",
			Render: Behaviour,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "side", options: SIDES },
			{ kind: "choice", name: "align", options: ALIGNS },
			{ kind: "choice", name: "label", options: ["text", "structured"] },
			{ kind: "flag", name: "wrapTrigger" },
			{ kind: "flag", name: "disabled" },
		],
		initial: { side: "top", align: "center", label: "text" },
		Preview: PlaygroundPreview,
		code: playgroundCode,
	},
};
