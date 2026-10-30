import { RiAddLine, RiCloseLine, RiFolderOpenLine, RiPencilLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { type KeyboardEvent, useState } from "react";
import { TreeRow } from "@/panels/TreeRow";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const FLAGS = [
	"icons",
	"separator",
	"disabled",
	"highlight",
	"keyboard",
	"triggerDisabled",
] as const;
type Config = Record<(typeof FLAGS)[number], boolean>;

const toConfig = (values: PlaygroundValues): Config =>
	Object.fromEntries(FLAGS.map((flag) => [flag, values[flag] === true])) as Config;

function openFromKeyboard(event: KeyboardEvent<HTMLElement>) {
	if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
	event.preventDefault();
	const rect = event.currentTarget.getBoundingClientRect();
	event.currentTarget.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left, clientY: rect.bottom }),
	);
}

function Specimen({ config }: { config: Config }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<ContextMenu open={open} onOpenChange={setOpen}>
			<ContextMenuTrigger
				asChild
				disabled={config.triggerDisabled}
				onKeyDown={config.keyboard ? openFromKeyboard : undefined}
			>
				<div className="w-224">
					<TreeRow
						testid="project-item"
						kind="dir"
						label="thinkrail"
						active={config.highlight && open}
						onClick={() => {}}
					/>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => {}}>
					{config.icons ? <RiAddLine /> : null}
					{t("panels.projectTree.createWorkspace")}
				</ContextMenuItem>
				<ContextMenuItem disabled={config.disabled} onSelect={() => {}}>
					{config.icons ? <RiFolderOpenLine /> : null}
					{t("panels.projectTree.openExistingWorktree")}
				</ContextMenuItem>
				{config.separator ? <ContextMenuSeparator /> : null}
				<ContextMenuItem onSelect={() => {}}>
					{config.icons ? <RiPencilLine /> : null}
					{t("common.rename")}
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => {}}>
					{config.icons ? <RiCloseLine /> : null}
					{t("panels.projectTree.closeProject")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

type Line = readonly [depth: number, text: string];

function code(config: Config): string {
	const item = (icon: string, label: string, disabled = false): Line[] => [
		[2, `<ContextMenuItem${disabled ? " disabled" : ""} onSelect={() => {}}>`],
		...(config.icons ? ([[3, `<${icon} />`]] as Line[]) : []),
		[3, `{t("${label}")}`],
		[2, "</ContextMenuItem>"],
	];
	const triggerProps = [
		"asChild",
		...(config.triggerDisabled ? ["disabled"] : []),
		...(config.keyboard ? ["onKeyDown={openFromKeyboard}"] : []),
	];
	const controlled = config.highlight;
	const lines: Line[] = [
		[0, controlled ? "<ContextMenu open={open} onOpenChange={setOpen}>" : "<ContextMenu>"],
		[1, `<ContextMenuTrigger ${triggerProps.join(" ")}>`],
		[2, '<div className="w-224">'],
		[
			3,
			`<TreeRow testid="project-item" kind="dir" label={name}${controlled ? " active={open}" : ""} onClick={select} />`,
		],
		[2, "</div>"],
		[1, "</ContextMenuTrigger>"],
		[1, "<ContextMenuContent>"],
		...item("RiAddLine", "panels.projectTree.createWorkspace"),
		...item("RiFolderOpenLine", "panels.projectTree.openExistingWorktree", config.disabled),
		...(config.separator ? ([[2, "<ContextMenuSeparator />"]] as Line[]) : []),
		...item("RiPencilLine", "common.rename"),
		...item("RiCloseLine", "panels.projectTree.closeProject"),
		[1, "</ContextMenuContent>"],
		[0, "</ContextMenu>"],
	];
	const imports = [
		"ContextMenu",
		"ContextMenuContent",
		"ContextMenuItem",
		...(config.separator ? ["ContextMenuSeparator"] : []),
		"ContextMenuTrigger",
	];
	return [
		`import { ${imports.join(", ")} } from "@thinkrail/ui/context-menu";`,
		"",
		...lines.map(([depth, text]) => `${"\t".repeat(depth)}${text}`),
	].join("\n");
}

const LIVE: Config = {
	icons: true,
	separator: true,
	disabled: true,
	highlight: true,
	keyboard: true,
	triggerDisabled: false,
};

function States() {
	return (
		<Table
			head={["Trigger", "Row"]}
			rows={[
				[
					<code key="name" className="tr-code-text">
						enabled
					</code>,
					<Specimen key="row" config={LIVE} />,
				],
				[
					<code key="name" className="tr-code-text">
						disabled
					</code>,
					<Specimen key="row" config={{ ...LIVE, triggerDisabled: true }} />,
				],
			]}
		/>
	);
}

export const contextMenuShowcase: Showcase = {
	sections: [{ id: "states", Render: States }],
	playground: {
		controls: FLAGS.map((name) => ({ kind: "flag" as const, name })),
		initial: {
			icons: true,
			separator: true,
			disabled: false,
			highlight: true,
			keyboard: true,
			triggerDisabled: false,
		},
		Preview: ({ values }) => <Specimen config={toConfig(values)} />,
		code: (values) => code(toConfig(values)),
	},
};
