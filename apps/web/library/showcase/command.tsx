import { RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@thinkrail/ui/command";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const REMOTE = ["origin/main", "origin/release-2.4"];
const LOCAL = ["main", "feature/command-docs"];
const DISABLED = "origin/release-2.4";

interface SpecimenConfig {
	input: boolean;
	headings: boolean;
	separator: boolean;
	disabledItem: boolean;
	loop: boolean;
	shouldFilter: boolean;
	vimBindings: boolean;
	disablePointerSelection: boolean;
	query?: string;
}

const BASE: SpecimenConfig = {
	input: true,
	headings: true,
	separator: false,
	disabledItem: false,
	loop: false,
	shouldFilter: true,
	vimBindings: true,
	disablePointerSelection: false,
};

function Specimen({ config }: { config: SpecimenConfig }) {
	const t = useT();
	const [query, setQuery] = useState(config.query ?? "");
	const row = (ref: string) => (
		<CommandItem
			key={ref}
			value={ref}
			disabled={config.disabledItem && ref === DISABLED}
			onSelect={() => {}}
		>
			<RiGitBranchLine className="size-14 shrink-0 text-text-muted" />
			<span className="truncate">{ref}</span>
		</CommandItem>
	);
	return (
		<Command
			className="w-240"
			label={t("panels.branchPicker.search")}
			loop={config.loop}
			shouldFilter={config.shouldFilter}
			vimBindings={config.vimBindings}
			disablePointerSelection={config.disablePointerSelection}
		>
			{config.input ? (
				<CommandInput
					placeholder={t("panels.branchPicker.search")}
					value={query}
					onValueChange={setQuery}
				/>
			) : null}
			<CommandList>
				<CommandEmpty>{t("panels.branchPicker.empty")}</CommandEmpty>
				<CommandGroup
					heading={config.headings ? t("panels.branchPicker.remote") : undefined}
					value="remote"
				>
					{REMOTE.map(row)}
				</CommandGroup>
				{config.separator ? <CommandSeparator /> : null}
				<CommandGroup
					heading={config.headings ? t("panels.branchPicker.local") : undefined}
					value="local"
				>
					{LOCAL.map(row)}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}

/**
 * cmdk scrolls its highlighted row into view when it mounts. In a popover that is a no-op; inline on
 * this page it would jump the page to the specimen, so a specimen mounts only once its slot is in view.
 */
function WhenInView({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const node = ref.current;
		if (!node || visible) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
			},
			{ threshold: 1 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [visible]);
	return visible ? children : <div ref={ref} className="h-160 w-240" />;
}

const STATES: readonly { state: string; config: SpecimenConfig; note: string }[] = [
	{
		state: "Rest · highlighted",
		config: BASE,
		note: "cmdk highlights the first row. Move the pointer or use the arrows to move the `control-bg-selected` fill; there is no separate hover look.",
	},
	{
		state: "Filtered",
		config: { ...BASE, separator: true, query: "main" },
		note: "The query `main` keeps only matching rows, ranked; the separator between the groups is gone while searching.",
	},
	{
		state: "Empty",
		config: { ...BASE, query: "zzz" },
		note: "No match: CommandEmpty replaces the list.",
	},
	{
		state: "Disabled item",
		config: { ...BASE, disabledItem: true },
		note: "`origin/release-2.4` is `disabled`: skipped by the arrows and the pointer, but drawn like an enabled row.",
	},
	{
		state: "Separator",
		config: { ...BASE, separator: true },
		note: "CommandSeparator between the groups while the search is empty.",
	},
];

function StateMatrix() {
	return (
		<Table
			head={["State", "Live", "What to look for"]}
			rows={STATES.map(({ state, config, note }) => [
				<span key="state" className="tr-text-emphasis">
					{state}
				</span>,
				<WhenInView key="live">
					<Specimen config={config} />
				</WhenInView>,
				<InlineMarkdown key="note" source={note} />,
			])}
		/>
	);
}

const FLAGS = [
	"input",
	"headings",
	"separator",
	"disabledItem",
	"loop",
	"shouldFilter",
	"vimBindings",
	"disablePointerSelection",
] as const;

function toConfig(values: PlaygroundValues): SpecimenConfig {
	return Object.fromEntries(
		FLAGS.map((flag) => [flag, values[flag] === true]),
	) as unknown as SpecimenConfig;
}

function code(values: PlaygroundValues) {
	const config = toConfig(values);
	const rootProps = [
		config.loop ? " loop" : "",
		config.shouldFilter ? "" : " shouldFilter={false}",
		config.vimBindings ? "" : " vimBindings={false}",
		config.disablePointerSelection ? " disablePointerSelection" : "",
	].join("");
	const heading = (key: string) => (config.headings ? ` heading={t("${key}")}` : "");
	const item = (ref: string) =>
		`\t\t\t<CommandItem value="${ref}"${config.disabledItem && ref === DISABLED ? " disabled" : ""} onSelect={() => pick("${ref}")}>\n\t\t\t\t<RiGitBranchLine className="size-14 shrink-0 text-text-muted" />\n\t\t\t\t<span className="truncate">${ref}</span>\n\t\t\t</CommandItem>`;
	return [
		`<Command label={t("panels.branchPicker.search")}${rootProps}>`,
		config.input ? `\t<CommandInput placeholder={t("panels.branchPicker.search")} />` : null,
		"\t<CommandList>",
		`\t\t<CommandEmpty>{t("panels.branchPicker.empty")}</CommandEmpty>`,
		`\t\t<CommandGroup${heading("panels.branchPicker.remote")} value="remote">`,
		...REMOTE.map(item),
		"\t\t</CommandGroup>",
		config.separator ? "\t\t<CommandSeparator />" : null,
		`\t\t<CommandGroup${heading("panels.branchPicker.local")} value="local">`,
		...LOCAL.map(item),
		"\t\t</CommandGroup>",
		"\t</CommandList>",
		"</Command>",
	]
		.filter((line) => line !== null)
		.join("\n");
}

export const commandShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component with real props. Type into the inputs, move the pointer and press the arrow keys inside a list.",
			Render: StateMatrix,
		},
	],
	playground: {
		controls: FLAGS.map((name) => ({ kind: "flag" as const, name })),
		initial: { input: true, headings: true, shouldFilter: true, vimBindings: true },
		Preview: ({ values }) => (
			<WhenInView>
				<Specimen key={JSON.stringify(values)} config={toConfig(values)} />
			</WhenInView>
		),
		code,
	},
};
