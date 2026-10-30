import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { cn } from "@thinkrail/ui/utils";
import { Fragment } from "react";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

type Direction = "horizontal" | "vertical";

interface SpecimenConfig {
	direction: Direction;
	panels: number;
	collapsible: boolean;
	disabled: boolean;
}

const LABELS = [
	"workbench.tool.projects",
	"workbench.center.group",
	"workbench.tool.review",
] as const;

function Specimen({ direction, panels, collapsible, disabled }: SpecimenConfig) {
	const t = useT();
	const size = 100 / panels;
	const labels = panels === 2 ? LABELS.slice(0, 2) : LABELS;
	return (
		<div className={direction === "vertical" ? "h-240 w-full max-w-[20rem]" : "h-120 w-full"}>
			<ResizablePanelGroup key={`${direction}-${panels}`} direction={direction}>
				{labels.map((label, index) => {
					const edge = index !== 1;
					return (
						<Fragment key={label}>
							{index > 0 ? <ResizableHandle direction={direction} disabled={disabled} /> : null}
							<ResizablePanel
								id={label}
								order={index + 1}
								defaultSize={size}
								minSize={15}
								{...(collapsible && edge ? { collapsible: true, collapsedSize: 0 } : {})}
							>
								<div
									className={cn(
										"flex h-full items-center justify-center tr-text-ui text-text-muted",
										edge ? "bg-container-sidebar-bg" : "bg-container-content-bg",
									)}
								>
									{t(label)}
								</div>
							</ResizablePanel>
						</Fragment>
					);
				})}
			</ResizablePanelGroup>
		</div>
	);
}

const ROWS: readonly { state: string; how: string; config: SpecimenConfig }[] = [
	{
		state: "Horizontal",
		how: "Hover the line, drag it, or Tab to it and press ←/→, Home, End.",
		config: { direction: "horizontal", panels: 2, collapsible: false, disabled: false },
	},
	{
		state: "Vertical",
		how: '`direction="vertical"` on the group and on the handle. ↑/↓ resize.',
		config: { direction: "vertical", panels: 2, collapsible: false, disabled: false },
	},
	{
		state: "Collapsible side",
		how: "`collapsible` + `collapsedSize={0}`. Drag past `minSize`, or focus the handle and press Enter.",
		config: { direction: "horizontal", panels: 2, collapsible: true, disabled: false },
	},
	{
		state: "Disabled",
		how: "`disabled` on the handle: no hover colour, no drag, no keyboard resize.",
		config: { direction: "horizontal", panels: 2, collapsible: false, disabled: true },
	},
];

function States() {
	return (
		<Table
			head={["Case", "Try it", "Live"]}
			rows={ROWS.map((row) => [
				<span key="state" className="tr-text-emphasis">
					{row.state}
				</span>,
				<InlineMarkdown key="how" source={row.how} />,
				<div key="live" className="w-full min-w-[16rem]">
					<Specimen {...row.config} />
				</div>,
			])}
		/>
	);
}

function toConfig(values: PlaygroundValues): SpecimenConfig {
	return {
		direction: (values.direction as Direction | undefined) ?? "horizontal",
		panels: Number(values.panels ?? "2"),
		collapsible: values.collapsible === true,
		disabled: values.disabled === true,
	};
}

function code(values: PlaygroundValues) {
	const { direction, panels, collapsible, disabled } = toConfig(values);
	const handleProps = [
		direction === "vertical" ? ' direction="vertical"' : "",
		disabled ? " disabled" : "",
	].join("");
	const size = Math.round((100 / panels) * 100) / 100;
	const labels = panels === 2 ? LABELS.slice(0, 2) : LABELS;
	const lines = [`<ResizablePanelGroup direction="${direction}">`];
	labels.forEach((label, index) => {
		if (index > 0) lines.push(`\t<ResizableHandle${handleProps} />`);
		const collapse = collapsible && index !== 1 ? " collapsible collapsedSize={0}" : "";
		lines.push(
			`\t<ResizablePanel id="${label}" order={${index + 1}} defaultSize={${size}} minSize={15}${collapse}>`,
			`\t\t{t("${label}")}`,
			"\t</ResizablePanel>",
		);
	});
	lines.push("</ResizablePanelGroup>");
	return lines.join("\n");
}

export const resizableShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is a real panel group. The handle is a hairline in `border-default` that turns `primary` while the pointer is over it or dragging; click into the page and press Tab to reach a handle from the keyboard.",
			Render: States,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "direction", options: ["horizontal", "vertical"] },
			{ kind: "choice", name: "panels", options: ["2", "3"] },
			{ kind: "flag", name: "collapsible" },
			{ kind: "flag", name: "disabled" },
		],
		initial: { direction: "horizontal", panels: "2" },
		Preview: ({ values }) => <Specimen {...toConfig(values)} />,
		code,
	},
};
