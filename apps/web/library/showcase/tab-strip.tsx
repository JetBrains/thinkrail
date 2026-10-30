import { useRef, useState } from "react";
import type { LayoutAttention, LayoutGroupLocation } from "@/shell/layout/model";
import type {
	LayoutAuxiliaryTab,
	LayoutCenterTab,
	LayoutTab,
	WorkspaceLayoutDocument,
} from "@/shell/layout/types";
import { TabStrip } from "@/shell/layout/workbenchTabs";
import { Table } from "../parts/Section";
import type { PlaygroundConfig, PlaygroundValues, Showcase } from "./types";

const ATTENTION: LayoutAttention = {
	selectedByGroup: {},
	lastFocusedCenterGroupId: "center",
	lastFocusedSideGroupId: {},
	navigationClockByGroup: {},
};

const KINDS: readonly [string, LayoutTab][] = [
	["file", { kind: "file", id: "file", name: "auth.ts", path: "src/auth.ts" }],
	[
		"diff",
		{ kind: "diff", id: "diff", name: "", path: "src/auth.ts", scope: { kind: "uncommitted" } },
	],
	["changes", { kind: "changes", id: "changes", name: "", scope: { kind: "branch" } }],
	["chat", { kind: "chat", id: "chat", name: "Fix login redirect", sessionId: "s1" }],
	[
		"document",
		{
			kind: "document",
			id: "document",
			name: "Fix login redirect",
			documentKind: "todo-plan",
			sourceId: "s1",
			docPath: "plan.md",
		},
	],
	["terminal", { kind: "terminal", id: "terminal", name: "Terminal 1", tabKey: "t1" }],
];

const FILES = [
	"auth.ts",
	"session.ts",
	"routes.tsx",
	"login.tsx",
	"api.ts",
	"store.ts",
	"theme.css",
];
const fileTab = (name: string): LayoutTab => ({
	kind: "file",
	id: name,
	name,
	path: `src/${name}`,
});
const OUTSIDE_TAB = fileTab("dragged.ts");

const isCenterTab = (tab: LayoutTab): tab is LayoutCenterTab => tab.kind !== "tool";
const isAuxiliaryTab = (tab: LayoutTab): tab is LayoutAuxiliaryTab =>
	tab.kind === "terminal" || tab.kind === "tool";

function documentFor(location: LayoutGroupLocation, tabs: LayoutTab[]): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: location.area === "center" ? tabs.filter(isCenterTab) : [],
		},
		left: { visible: true, width: 0.2, groups: [] },
		right: { visible: true, width: 0.25, groups: [] },
		bottom: {
			visible: location.area === "bottom",
			height: 0.3,
			alignment: "center",
			groups:
				location.area === "bottom"
					? [
							{
								id: "bottom",
								weight: 1,
								folded: false,
								tabs: tabs.filter(isAuxiliaryTab),
							},
						]
					: [],
		},
		toolRestoreTargets: {},
	};
}

interface StripConfig {
	area?: "center" | "bottom";
	tabs: LayoutTab[];
	selected?: string;
	preview?: string;
	dropHint?: boolean;
}

function Strip({ area = "center", tabs: initialTabs, selected, preview, dropHint }: StripConfig) {
	const location: LayoutGroupLocation =
		area === "center" ? { area, groupId: "center" } : { area, groupId: "bottom" };
	const [tabs, setTabs] = useState(initialTabs);
	const [selectedId, setSelectedId] = useState(selected);
	const selectionEpochRef = useRef(0);
	const document = documentFor(location, tabs);
	return (
		<div className="w-full min-w-[12rem]">
			<TabStrip
				document={document}
				readAttention={() => ATTENTION}
				selectionEpochRef={selectionEpochRef}
				location={location}
				tabs={tabs}
				selectedId={selectedId}
				previewId={preview}
				maxSideGroups={6}
				maxBottomGroups={3}
				draggingTab={dropHint ? OUTSIDE_TAB : null}
				onSelect={setSelectedId}
				onClose={(tab) =>
					setTabs((current) => current.filter((candidate) => candidate.id !== tab.id))
				}
				onApply={() => {}}
				onFocusAdjacentGroup={() => {}}
				onHideSide={() => {}}
				onRevealTool={() => {}}
				onRenameChat={undefined}
				canFocusAdjacentGroup={false}
				renderTabAdornment={() => null}
			/>
		</div>
	);
}

const code = (text: string) => (
	<code key="name" className="tr-code-text">
		{text}
	</code>
);

function Kinds() {
	return (
		<Table
			head={["kind", "At rest", "Active"]}
			rows={KINDS.map(([kind, tab]) => [
				code(kind),
				<Strip key="rest" tabs={[tab]} area={kind === "terminal" ? "bottom" : "center"} />,
				<Strip
					key="active"
					tabs={[tab]}
					selected={tab.id}
					area={kind === "terminal" ? "bottom" : "center"}
				/>,
			])}
		/>
	);
}

const THREE = FILES.slice(0, 3).map(fileTab);

function StateMatrix() {
	return (
		<Table
			head={["State", "Props", "Live"]}
			rows={[
				[
					"Rest · active · hover · Tab",
					code('selectedId="session.ts"'),
					<Strip key="live" tabs={THREE} selected="session.ts" />,
				],
				[
					"Preview",
					code('previewId="routes.tsx"'),
					<Strip key="live" tabs={THREE} selected="routes.tsx" preview="routes.tsx" />,
				],
				[
					"Drop hint",
					code("draggingTab={tabFromAnotherGroup}"),
					<Strip key="live" tabs={THREE} selected="auth.ts" dropHint />,
				],
				[
					"Overflowing",
					code("tabs={sevenTabs}"),
					<div key="live" className="w-full max-w-[20rem]">
						<Strip tabs={FILES.map(fileTab)} selected="login.tsx" />
					</div>,
				],
				["Empty", code("tabs={[]}"), <Strip key="live" tabs={[]} />],
			]}
		/>
	);
}

function toConfig(
	values: PlaygroundValues,
): StripConfig & { area: "center" | "bottom"; count: number } {
	const count = Number(values.tabs);
	const area = values.area === "bottom" ? "bottom" : "center";
	const tabs =
		area === "bottom"
			? Array.from(
					{ length: count },
					(_, index): LayoutTab => ({
						kind: "terminal",
						id: `terminal-${index + 1}`,
						name: `Terminal ${index + 1}`,
						tabKey: `t${index + 1}`,
					}),
				)
			: FILES.slice(0, count).map(fileTab);
	const selected = tabs[1]?.id ?? tabs[0]?.id;
	return {
		area,
		count,
		tabs,
		...(selected ? { selected } : {}),
		...(values.preview === true && area === "center" && selected ? { preview: selected } : {}),
		dropHint: values.dropHint === true,
	};
}

const playground: PlaygroundConfig = {
	controls: [
		{ kind: "choice", name: "area", options: ["center", "bottom"] },
		{ kind: "choice", name: "tabs", options: ["1", "3", "7"] },
		{ kind: "flag", name: "preview" },
		{ kind: "flag", name: "dropHint" },
	],
	initial: { area: "center", tabs: "3" },
	Preview: ({ values }) => {
		const config = toConfig(values);
		return (
			<div className="w-full max-w-[24rem]">
				<Strip
					key={JSON.stringify(values)}
					area={config.area}
					tabs={config.tabs}
					{...(config.selected ? { selected: config.selected } : {})}
					{...(config.preview ? { preview: config.preview } : {})}
					dropHint={config.dropHint ?? false}
				/>
			</div>
		);
	},
	code: (values) => {
		const config = toConfig(values);
		const groupId = config.area === "center" ? "center" : "bottom";
		return [
			"<TabStrip",
			"\tdocument={document}",
			"\treadAttention={readAttention}",
			"\tselectionEpochRef={selectionEpochRef}",
			`\tlocation={{ area: "${config.area}", groupId: "${groupId}" }}`,
			`\ttabs={tabs} // ${config.count} ${config.area === "center" ? "file" : "terminal"} tab${config.count === 1 ? "" : "s"}`,
			`\tselectedId="${config.selected ?? ""}"`,
			...(config.preview ? [`\tpreviewId="${config.preview}"`] : []),
			"\tmaxSideGroups={6}",
			"\tmaxBottomGroups={3}",
			`\tdraggingTab={${config.dropHint ? "draggedTab" : "null"}}`,
			"\tonSelect={setSelectedId}",
			"\tonClose={closeTab}",
			"\tonApply={(result) => commit(result.document)}",
			"\tonFocusAdjacentGroup={focusAdjacentGroup}",
			"\tonHideSide={hideSide}",
			"\tonRevealTool={revealTool}",
			"\tonRenameChat={undefined}",
			"\tcanFocusAdjacentGroup={false}",
			"\trenderTabAdornment={() => null}",
			"/>",
		].join("\n");
	},
};

export const tabStripShowcase: Showcase = {
	sections: [
		{ id: "kinds", Render: Kinds },
		{ id: "states", Render: StateMatrix },
	],
	playground,
};
