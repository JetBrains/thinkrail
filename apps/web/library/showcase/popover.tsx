import { RiArrowDownSLine, RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import type { ComponentProps } from "react";
import type { PlaygroundValues, Showcase } from "./types";

type ContentProps = ComponentProps<typeof PopoverContent>;
type Side = NonNullable<ContentProps["side"]>;
type Align = NonNullable<ContentProps["align"]>;

const SIDES = ["top", "right", "bottom", "left"] as const satisfies readonly Side[];
const ALIGNS = ["start", "center", "end"] as const satisfies readonly Align[];

function config(values: PlaygroundValues) {
	return { side: values.side as Side, align: values.align as Align };
}

function Preview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const { side, align } = config(values);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m" iconLeft={RiGitBranchLine} iconRight={RiArrowDownSLine}>
					feature/popover-docs
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align={align}
				aria-label={t("shell.location.branch.caption")}
				className="flex w-288 flex-col gap-4 p-12"
			>
				<span className="tr-text-metadata text-text-subtle">
					{t("shell.location.branch.basedOn")}
				</span>
				<span className="truncate tr-code-text">main</span>
			</PopoverContent>
		</Popover>
	);
}

function code(values: PlaygroundValues): string {
	const { side, align } = config(values);
	return [
		"<Popover>",
		"\t<PopoverTrigger asChild>",
		'\t\t<Button variant="outline" size="m" iconLeft={RiGitBranchLine}>{branch}</Button>',
		"\t</PopoverTrigger>",
		"\t<PopoverContent",
		...(side === "bottom" ? [] : [`\t\tside="${side}"`]),
		...(align === "center" ? [] : [`\t\talign="${align}"`]),
		'\t\taria-label={t("shell.location.branch.caption")}',
		'\t\tclassName="flex w-288 flex-col gap-4 p-12"',
		"\t>",
		"\t\t…",
		"\t</PopoverContent>",
		"</Popover>",
	].join("\n");
}

export const popoverShowcase: Showcase = {
	sections: [],
	playground: {
		controls: [
			{ kind: "choice", name: "side", options: SIDES },
			{ kind: "choice", name: "align", options: ALIGNS },
		],
		initial: { side: "bottom", align: "start" },
		Preview,
		code,
	},
};
