import type { ReactNode } from "react";
import { statusNameClass } from "@/panels/changesModel";
import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { TreeRow } from "@/panels/TreeRow";
import { ViewedMark } from "@/panels/ViewedMark";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

type RowProps = Partial<Omit<Parameters<typeof TreeRow>[0], "testid" | "label">>;

const KINDS: readonly {
	name: string;
	props: RowProps & { kind: "dir" | "file" };
	label: string;
}[] = [
	{ name: "Folder, collapsed", props: { kind: "dir" }, label: "src" },
	{ name: "Folder, expanded", props: { kind: "dir", expanded: true }, label: "src" },
	{ name: "File", props: { kind: "file" }, label: "index.ts" },
];

const COLUMNS: readonly { name: string; props: RowProps }[] = [
	{ name: "Hover · Tab", props: {} },
	{ name: "active", props: { active: true } },
	{ name: "subtle", props: { subtle: true } },
	{ name: "wrapper + active", props: { highlight: "wrapper", active: true } },
];

function Cell({ children }: { children: ReactNode }) {
	return <div className="w-[12rem]">{children}</div>;
}

function StateMatrix() {
	return (
		<Table
			head={["Kind", ...COLUMNS.map((column) => column.name)]}
			rows={KINDS.map((kind) => [
				<span key="kind" className="tr-text-emphasis">
					{kind.name}
				</span>,
				...COLUMNS.map((column) => (
					<Cell key={column.name}>
						<TreeRow testid="tree-row" label={kind.label} {...kind.props} {...column.props} />
					</Cell>
				)),
			])}
		/>
	);
}

const TRAILING = ["none", "diff badge", "viewed + badge"] as const;
const STATUS = ["none", "added", "modified", "deleted", "renamed"] as const;
const FLAGS = ["expanded", "active", "subtle"] as const;

function trailingNode(value: unknown): ReactNode {
	if (value === "diff badge") return <DiffStatBadge added={12} removed={4} />;
	if (value === "viewed + badge")
		return (
			<>
				<ViewedMark />
				<DiffStatBadge added={12} removed={4} />
			</>
		);
	return undefined;
}

function rowProps(values: PlaygroundValues) {
	const status = values.status as (typeof STATUS)[number];
	return {
		kind: values.kind === "dir" ? ("dir" as const) : ("file" as const),
		label: values.label === "long" ? "WorkspaceFilesPanelToolbarActions.tsx" : "TreeRow.tsx",
		highlight: values.highlight === "wrapper" ? ("wrapper" as const) : ("self" as const),
		labelClassName: status === "none" ? undefined : statusNameClass(status),
		expanded: values.expanded === true,
		active: values.active === true,
		subtle: values.subtle === true,
	};
}

function Preview({ values }: { values: PlaygroundValues }) {
	const props = rowProps(values);
	return (
		<div className="w-[16rem]">
			<TreeRow
				testid="tree-row"
				kind={props.kind}
				label={props.label}
				highlight={props.highlight}
				expanded={props.expanded}
				active={props.active}
				subtle={props.subtle}
				trailing={trailingNode(values.trailing)}
				{...(props.labelClassName ? { labelClassName: props.labelClassName } : {})}
			/>
		</div>
	);
}

function code(values: PlaygroundValues) {
	const props = rowProps(values);
	const lines = [
		'testid="file-node"',
		`kind="${props.kind}"`,
		`label="${props.label}"`,
		props.kind === "dir" && props.expanded ? "expanded" : null,
		props.active ? "active" : null,
		props.subtle ? "subtle" : null,
		props.highlight === "wrapper" ? 'highlight="wrapper"' : null,
		values.status !== "none" ? `labelClassName={statusNameClass("${values.status}")}` : null,
		values.trailing === "diff badge"
			? "trailing={<DiffStatBadge added={12} removed={4} />}"
			: values.trailing === "viewed + badge"
				? "trailing={\n\t\t<>\n\t\t\t<ViewedMark />\n\t\t\t<DiffStatBadge added={12} removed={4} />\n\t\t</>\n\t}"
				: null,
		"onClick={() => {}}",
	].filter(Boolean);
	return `<TreeRow\n${lines.map((line) => `\t${line}`).join("\n")}\n/>`;
}

export const treeRowShowcase: Showcase = {
	sections: [{ id: "states", Render: StateMatrix }],
	playground: {
		controls: [
			{ kind: "choice", name: "kind", options: ["file", "dir"] },
			{ kind: "choice", name: "label", options: ["short", "long"] },
			{ kind: "choice", name: "status", options: STATUS },
			{ kind: "choice", name: "trailing", options: TRAILING },
			{ kind: "choice", name: "highlight", options: ["self", "wrapper"] },
			...FLAGS.map((name) => ({ kind: "flag" as const, name })),
		],
		initial: {
			kind: "file",
			label: "short",
			status: "none",
			trailing: "diff badge",
			highlight: "self",
		},
		Preview,
		code,
	},
};
