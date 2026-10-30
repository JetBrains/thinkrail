import {
	RiArrowDownSLine,
	RiCheckLine,
	RiExternalLinkLine,
	RiFileCopyLine,
	RiMore2Line,
	RiPencilLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useState } from "react";
import type { PlaygroundValues, Showcase } from "./types";

const ALIGNS = ["start", "center", "end"] as const;
const SIDES = ["bottom", "top", "right", "left"] as const;
const TRIGGERS = ["IconButton", "Button"] as const;
const FLAGS = ["icons", "label", "submenu", "disabled", "radio"] as const;
const EDITORS = ["VS Code", "Cursor"];
const ALIGNMENT_LABELS = {
	full: "workbench.bottom.alignFull",
	center: "workbench.bottom.alignCenter",
	"center-left": "workbench.bottom.alignCenterLeft",
} as const;
type Alignment = keyof typeof ALIGNMENT_LABELS;
const isAlignment = (value: string): value is Alignment => value in ALIGNMENT_LABELS;

type Align = (typeof ALIGNS)[number];
type Side = (typeof SIDES)[number];

interface Config {
	trigger: (typeof TRIGGERS)[number];
	align: Align;
	side: Side;
	icons: boolean;
	label: boolean;
	submenu: boolean;
	disabled: boolean;
	radio: boolean;
}

function toConfig(values: PlaygroundValues): Config {
	return {
		trigger: values.trigger === "Button" ? "Button" : "IconButton",
		align: ALIGNS.find((align) => align === values.align) ?? "end",
		side: SIDES.find((side) => side === values.side) ?? "bottom",
		icons: values.icons === true,
		label: values.label === true,
		submenu: values.submenu === true,
		disabled: values.disabled === true,
		radio: values.radio === true,
	};
}

/** Every part of the menu in one real, interactive instance. */
function Specimen({ config }: { config: Config }) {
	const t = useT();
	const [alignment, setAlignment] = useState<Alignment>("full");
	const label = t("panels.projectTree.workspaceActions", { name: "feature-login" });
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				{config.trigger === "Button" ? (
					<Button variant="outline" size="m" iconRight={RiArrowDownSLine}>
						{t("shell.location.ship.moreActions")}
					</Button>
				) : (
					<IconButton icon={RiMore2Line} label={label} />
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align={config.align} side={config.side}>
				{config.label ? <DropdownMenuLabel>feature-login</DropdownMenuLabel> : null}
				{config.submenu ? (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							{config.icons ? <RiExternalLinkLine /> : null}
							{t("panels.projectTree.openIn")}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{EDITORS.map((editor) => (
								<DropdownMenuItem key={editor} onSelect={() => {}}>
									{editor}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				) : null}
				<DropdownMenuItem onSelect={() => {}}>
					{config.icons ? <RiPencilLine /> : null}
					{t("common.rename")}
				</DropdownMenuItem>
				<DropdownMenuItem disabled={config.disabled} onSelect={() => {}}>
					{config.icons ? <RiFileCopyLine /> : null}
					{t("panels.projectTree.copyPath")}
				</DropdownMenuItem>
				{config.radio ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuRadioGroup
							value={alignment}
							onValueChange={(value) => {
								if (isAlignment(value)) setAlignment(value);
							}}
						>
							{(Object.keys(ALIGNMENT_LABELS) as Alignment[]).map((id) => (
								<DropdownMenuRadioItem key={id} value={id}>
									{id === alignment ? (
										<RiCheckLine />
									) : (
										<span aria-hidden className="size-14 shrink-0" />
									)}
									{t(ALIGNMENT_LABELS[id])}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type Line = readonly [depth: number, text: string];

function code(config: Config): string {
	const icon = (depth: number, name: string): Line[] =>
		config.icons ? [[depth, `<${name} />`]] : [];
	const imports = [
		"DropdownMenu",
		"DropdownMenuContent",
		"DropdownMenuItem",
		...(config.label ? ["DropdownMenuLabel"] : []),
		...(config.radio
			? ["DropdownMenuRadioGroup", "DropdownMenuRadioItem", "DropdownMenuSeparator"]
			: []),
		...(config.submenu
			? ["DropdownMenuSub", "DropdownMenuSubContent", "DropdownMenuSubTrigger"]
			: []),
		"DropdownMenuTrigger",
	];
	const trigger: Line[] =
		config.trigger === "Button"
			? [
					[2, '<Button variant="outline" size="m" iconRight={RiArrowDownSLine}>'],
					[3, '{t("shell.location.ship.moreActions")}'],
					[2, "</Button>"],
				]
			: [
					[
						2,
						'<IconButton icon={RiMore2Line} label={t("panels.projectTree.workspaceActions", { name })} />',
					],
				];
	const contentProps = [
		`align="${config.align}"`,
		...(config.side === "bottom" ? [] : [`side="${config.side}"`]),
	];
	const lines: Line[] = [
		[0, "<DropdownMenu>"],
		[1, "<DropdownMenuTrigger asChild>"],
		...trigger,
		[1, "</DropdownMenuTrigger>"],
		[1, `<DropdownMenuContent ${contentProps.join(" ")}>`],
		...(config.label ? ([[2, "<DropdownMenuLabel>{name}</DropdownMenuLabel>"]] as Line[]) : []),
		...(config.submenu
			? ([
					[2, "<DropdownMenuSub>"],
					[3, "<DropdownMenuSubTrigger>"],
					...icon(4, "RiExternalLinkLine"),
					[4, '{t("panels.projectTree.openIn")}'],
					[3, "</DropdownMenuSubTrigger>"],
					[3, "<DropdownMenuSubContent>"],
					[4, "{editors.map((editor) => ("],
					[5, "<DropdownMenuItem key={editor} onSelect={() => openIn(editor)}>"],
					[6, "{editor}"],
					[5, "</DropdownMenuItem>"],
					[4, "))}"],
					[3, "</DropdownMenuSubContent>"],
					[2, "</DropdownMenuSub>"],
				] as Line[])
			: []),
		[2, "<DropdownMenuItem onSelect={rename}>"],
		...icon(3, "RiPencilLine"),
		[3, '{t("common.rename")}'],
		[2, "</DropdownMenuItem>"],
		[2, `<DropdownMenuItem${config.disabled ? " disabled" : ""} onSelect={copyPath}>`],
		...icon(3, "RiFileCopyLine"),
		[3, '{t("panels.projectTree.copyPath")}'],
		[2, "</DropdownMenuItem>"],
		...(config.radio
			? ([
					[2, "<DropdownMenuSeparator />"],
					[2, "<DropdownMenuRadioGroup value={alignment} onValueChange={onAlignmentChange}>"],
					[3, "{ALIGNMENTS.map((value) => ("],
					[4, "<DropdownMenuRadioItem key={value} value={value}>"],
					[5, "{value === alignment ? ("],
					[6, "<RiCheckLine />"],
					[5, ") : ("],
					[6, '<span aria-hidden className="size-14 shrink-0" />'],
					[5, ")}"],
					[5, "{t(ALIGNMENT_LABELS[value])}"],
					[4, "</DropdownMenuRadioItem>"],
					[3, "))}"],
					[2, "</DropdownMenuRadioGroup>"],
				] as Line[])
			: []),
		[1, "</DropdownMenuContent>"],
		[0, "</DropdownMenu>"],
	];
	return [
		`import { ${imports.join(", ")} } from "@thinkrail/ui/dropdown-menu";`,
		"",
		...lines.map(([depth, text]) => `${"\t".repeat(depth)}${text}`),
	].join("\n");
}

const ALL_PARTS: Config = {
	trigger: "IconButton",
	align: "start",
	side: "bottom",
	icons: true,
	label: true,
	submenu: true,
	disabled: true,
	radio: true,
};

function States() {
	return (
		<div className="flex flex-wrap items-center gap-16">
			<Specimen config={ALL_PARTS} />
			<span className="tr-text-ui text-text-muted">
				Open the menu: a heading, a submenu, an enabled and a disabled item, and a radio group.
			</span>
		</div>
	);
}

export const dropdownMenuShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"One real menu with every part. Hover or arrow through the rows to see the highlight; the disabled row is skipped; ArrowRight opens the submenu, whose trigger keeps its fill while open; choose a radio option to move the check. The trigger shows its selected look while the menu is open.",
			Render: States,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "trigger", options: TRIGGERS },
			{ kind: "choice", name: "align", options: ALIGNS },
			{ kind: "choice", name: "side", options: SIDES },
			...FLAGS.map((name) => ({ kind: "flag" as const, name })),
		],
		initial: {
			trigger: "IconButton",
			align: "end",
			side: "bottom",
			icons: true,
			label: false,
			submenu: false,
			disabled: false,
			radio: false,
		},
		Preview: ({ values }) => <Specimen config={toConfig(values)} />,
		code: (values) => code(toConfig(values)),
	},
};
