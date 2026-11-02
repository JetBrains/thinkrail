import { RiDeleteBin6Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { type ComponentProps, useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";
import type { PlaygroundValues, Showcase } from "./types";

type Props = ComponentProps<typeof ConfirmPopover>;
type Side = NonNullable<Props["side"]>;
type Align = NonNullable<Props["align"]>;

const SIDES = ["top", "right", "bottom", "left"] as const satisfies readonly Side[];
const ALIGNS = ["start", "center", "end"] as const satisfies readonly Align[];

function config(values: PlaygroundValues) {
	return {
		side: values.side as Side,
		align: values.align as Align,
		destructive: values.destructive === true,
		description: values.description === true,
		confirmLabel: values.confirmLabel === true,
	};
}

function Preview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const { side, align, destructive, description, confirmLabel } = config(values);
	return (
		<ConfirmPopover
			open={open}
			onOpenChange={setOpen}
			title={t("settings.templates.deleteTitle", { name: "review-checklist" })}
			{...(description ? { description: t("settings.templates.deleteDescription") } : {})}
			{...(confirmLabel ? { confirmLabel: t("common.delete") } : {})}
			destructive={destructive}
			onConfirm={() => {}}
			side={side}
			align={align}
		>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="m"
					{...(destructive ? { tone: "danger" as const } : {})}
					iconLeft={RiDeleteBin6Line}
				>
					{t("common.delete")}
				</Button>
			</PopoverTrigger>
		</ConfirmPopover>
	);
}

function code(values: PlaygroundValues): string {
	const { side, align, destructive, description, confirmLabel } = config(values);
	return [
		"<ConfirmPopover",
		"\topen={open}",
		"\tonOpenChange={setOpen}",
		'\ttitle={t("settings.templates.deleteTitle", { name })}',
		...(description ? ['\tdescription={t("settings.templates.deleteDescription")}'] : []),
		...(confirmLabel ? ['\tconfirmLabel={t("common.delete")}'] : []),
		...(destructive ? ["\tdestructive"] : []),
		"\tonConfirm={remove}",
		...(side === "bottom" ? [] : [`\tside="${side}"`]),
		...(align === "start" ? [] : [`\talign="${align}"`]),
		">",
		"\t<PopoverTrigger asChild>",
		`\t\t<Button variant="outline" size="m"${destructive ? ' tone="danger"' : ""} iconLeft={RiDeleteBin6Line}>`,
		'\t\t\t{t("common.delete")}',
		"\t\t</Button>",
		"\t</PopoverTrigger>",
		"</ConfirmPopover>",
	].join("\n");
}

export const confirmPopoverShowcase: Showcase = {
	sections: [],
	playground: {
		controls: [
			{ kind: "choice", name: "side", options: SIDES },
			{ kind: "choice", name: "align", options: ALIGNS },
			{ kind: "flag", name: "destructive" },
			{ kind: "flag", name: "description" },
			{ kind: "flag", name: "confirmLabel" },
		],
		initial: {
			side: "bottom",
			align: "end",
			destructive: true,
			description: true,
			confirmLabel: true,
		},
		Preview,
		code,
	},
};
