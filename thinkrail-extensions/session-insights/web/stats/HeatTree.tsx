import { RiFolderLine, RiPencilLine } from "@remixicon/react";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	HotspotDir,
	HotspotFile,
	StatsHotspotsResult,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { DiffStatBadge } from "@thinkrail/ui/diff-stat-badge";
import {
	extendFolderChain,
	type FolderChain,
	type FolderChainNode,
	startFolderChain,
} from "@thinkrail/ui/folder-chains";
import { TreeRow } from "@thinkrail/ui/tree-row";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState } from "react";
import { formatCount } from "../format";
import { ShareBar } from "../ShareBar";

const REVEALED = 5;

export function fileKey(file: Pick<HotspotFile, "projectId" | "path">): string {
	return `${file.projectId ?? ""}\u0000${file.path}`;
}

interface HeatNode extends FolderChainNode {
	key: string;
	projectId: string | null;
	dir: HotspotDir | null;
	file: HotspotFile | null;
	children: HeatNode[];
}

interface Figures {
	touches: number;
	edits: number;
	rework: number;
	added: number;
	removed: number;
}

function figuresOf(node: HeatNode, reworkChanges: number): Figures {
	if (node.file)
		return {
			touches: node.file.touches.value ?? 0,
			edits: node.file.edits + node.file.writes,
			rework: node.file.rework >= reworkChanges ? node.file.rework : 0,
			added: node.file.added,
			removed: node.file.removed,
		};
	return {
		touches: node.dir?.touches ?? 0,
		edits: (node.dir?.edits ?? 0) + (node.dir?.writes ?? 0),
		rework: node.dir?.rework ?? 0,
		added: node.dir?.added ?? 0,
		removed: node.dir?.removed ?? 0,
	};
}

function byHeat(reworkChanges: number) {
	return (a: HeatNode, b: HeatNode) => {
		if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
		const delta = figuresOf(b, reworkChanges).touches - figuresOf(a, reworkChanges).touches;
		return delta || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	};
}

/** The listed files nested under their folders, one root per project; folder figures are the server's. */
export function heatTree(result: StatsHotspotsResult): HeatNode[] {
	const { files, dirs, reworkChanges } = result.hotspots;
	const dirOf = new Map(dirs.map((dir) => [`${dir.projectId ?? ""}\u0000${dir.path}`, dir]));
	const roots = new Map<string, HeatNode>();
	const nodes = new Map<string, HeatNode>();
	const dirNode = (projectId: string | null, path: string): HeatNode => {
		const key = `${projectId ?? ""}\u0000${path}`;
		let node = nodes.get(key);
		if (node) return node;
		node = {
			kind: "dir",
			name: path.slice(path.lastIndexOf("/") + 1),
			path,
			key,
			projectId,
			dir: dirOf.get(key) ?? null,
			file: null,
			children: [],
		};
		nodes.set(key, node);
		if (path === "") roots.set(projectId ?? "", node);
		else
			dirNode(
				projectId,
				path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
			).children.push(node);
		return node;
	};
	for (const file of files) {
		const at = file.path.lastIndexOf("/");
		dirNode(file.projectId, at < 0 ? "" : file.path.slice(0, at)).children.push({
			kind: "file",
			name: file.path.slice(at + 1),
			path: file.path,
			key: fileKey(file),
			projectId: file.projectId,
			dir: null,
			file,
			children: [],
		});
	}
	const order = byHeat(reworkChanges);
	for (const node of nodes.values()) node.children.sort(order);
	return [...roots.values()].sort(order);
}

function revealed(result: StatsHotspotsResult): Set<string> {
	const open = new Set<string>();
	for (const file of result.hotspots.files.slice(0, REVEALED)) {
		const parts = file.path.split("/").slice(0, -1);
		open.add(`${file.projectId ?? ""}\u0000`);
		for (let depth = 1; depth <= parts.length; depth++)
			open.add(`${file.projectId ?? ""}\u0000${parts.slice(0, depth).join("/")}`);
	}
	return open;
}

/** A run of single-folder children shown as one row, and the folder it ends at. */
function folderRun(node: HeatNode): { chain: FolderChain; deepest: HeatNode } {
	let chain = startFolderChain(node);
	let deepest = node;
	for (;;) {
		const next = extendFolderChain(chain, deepest.children);
		if (!next) return { chain, deepest };
		chain = next.chain;
		deepest = next.directory;
	}
}

function Badges({ figures, max }: { figures: Figures; max: number }) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<span className="flex shrink-0 items-center gap-6 tr-text-caption tabular-nums">
			<ShareBar
				className="w-40 flex-none"
				total={max}
				parts={[{ key: "touches", value: figures.touches, fill: "fill-series-1" }]}
			/>
			<span data-testid="heat-touches" className="min-w-24 text-right text-text-muted">
				<span aria-hidden="true">{formatCount(locale, figures.touches)}</span>
				<span className="sr-only">
					{t("sessionInsights.hotspots.tree.touches", { count: figures.touches })}
				</span>
			</span>
			{figures.edits > 0 ? (
				<span data-testid="heat-edits" className="flex items-center gap-2 text-series-2">
					<RiPencilLine aria-hidden className="size-12" />
					<span aria-hidden="true">{formatCount(locale, figures.edits)}</span>
					<span className="sr-only">
						{t("sessionInsights.hotspots.tree.edits", { count: figures.edits })}
					</span>
				</span>
			) : null}
			{figures.rework > 0 ? (
				<span
					data-testid="heat-rework"
					className="rounded-full border border-feedback-error-muted px-4 text-feedback-error"
				>
					<span aria-hidden="true">
						{t("sessionInsights.hotspots.tree.reworkBadge", { count: figures.rework })}
					</span>
					<span className="sr-only">
						{t("sessionInsights.hotspots.tree.rework", { count: figures.rework })}
					</span>
				</span>
			) : null}
			<DiffStatBadge added={figures.added} removed={figures.removed} />
		</span>
	);
}

function HeatRow({
	node,
	level,
	max,
	reworkChanges,
	open,
	selected,
	onToggle,
	onSelect,
}: {
	node: HeatNode;
	level: number;
	max: number;
	reworkChanges: number;
	open: ReadonlySet<string>;
	selected: string | null;
	onToggle: (key: string) => void;
	onSelect: (file: HotspotFile) => void;
}) {
	if (node.kind === "file" && node.file) {
		const file = node.file;
		return (
			<li role="none">
				<TreeRow
					testid="heat-file"
					treeId={node.key}
					level={level}
					path={node.path}
					kind="file"
					active={selected === node.key}
					label={node.name}
					labelClassName="tr-code-text-small"
					onClick={() => onSelect(file)}
					trailing={<Badges figures={figuresOf(node, reworkChanges)} max={max} />}
				/>
			</li>
		);
	}
	const { chain, deepest } = folderRun(node);
	const expanded = open.has(deepest.key);
	return (
		<li role="none">
			<TreeRow
				testid="heat-dir"
				treeId={deepest.key}
				level={level}
				path={deepest.path}
				kind="dir"
				expanded={expanded}
				label={chain.label}
				onClick={() => onToggle(deepest.key)}
				trailing={<Badges figures={figuresOf(deepest, reworkChanges)} max={max} />}
			/>
			{expanded ? (
				<ul role="none" className="flex flex-col pl-tree-indent">
					{deepest.children.map((child) => (
						<HeatRow
							key={child.key}
							node={child}
							level={level + 1}
							max={max}
							reworkChanges={reworkChanges}
							open={open}
							selected={selected}
							onToggle={onToggle}
							onSelect={onSelect}
						/>
					))}
				</ul>
			) : null}
		</li>
	);
}

/**
 * The auxiliary heat tree: the hotspot files under their folders with touches, changes, rework ⟳N
 * and lines (+/−, from tool calls) per row; a picked file shows its "why" below.
 */
export function HeatTree({
	result,
	projectNames,
	selected,
	onSelect,
	detail,
}: {
	result: StatsHotspotsResult;
	projectNames: ReadonlyMap<string, string>;
	selected: string | null;
	onSelect: (file: HotspotFile) => void;
	detail: (file: HotspotFile) => ReactNode;
}) {
	const t = useT();
	const roots = heatTree(result);
	const [open, setOpen] = useState<ReadonlySet<string>>(() => revealed(result));
	const reworkChanges = result.hotspots.reworkChanges;
	const max = Math.max(1, ...result.hotspots.files.map((file) => file.touches.value ?? 0));
	const toggle = (key: string) => {
		const next = new Set(open);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setOpen(next);
	};
	const picked = result.hotspots.files.find((file) => fileKey(file) === selected) ?? null;
	const rows = (nodes: readonly HeatNode[]) =>
		nodes.map((node) => (
			<HeatRow
				key={node.key}
				node={node}
				level={1}
				max={max}
				reworkChanges={reworkChanges}
				open={open}
				selected={selected}
				onToggle={toggle}
				onSelect={onSelect}
			/>
		));
	return (
		<div data-testid="heat-tree" className="flex min-h-0 flex-col gap-8 p-8">
			<div className="flex items-center gap-4 px-4">
				<span className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.hotspots.tree.note", { count: result.hotspots.files.length })}
				</span>
				<Button
					variant="ghost"
					size="s"
					className="ml-auto"
					data-testid="heat-collapse"
					onClick={() => setOpen(new Set())}
				>
					{t("sessionInsights.hotspots.tree.collapse")}
				</Button>
			</div>
			{roots.length > 1 ? (
				<div data-testid="heat-rows" className="flex flex-col">
					{roots.map((root) => {
						const name = root.projectId
							? (projectNames.get(root.projectId) ?? root.projectId)
							: t("sessionInsights.group.unregistered");
						return (
							<div key={root.key} className="flex flex-col">
								<span
									data-testid="heat-project"
									className={cn(
										"flex h-panel-row items-center gap-4 px-4 tr-text-emphasis text-text-default",
									)}
								>
									<RiFolderLine aria-hidden className="size-14 text-text-muted" />
									{name}
								</span>
								<div role="tree" aria-label={name}>
									<ul role="none" className="flex flex-col pl-tree-indent">
										{rows(root.children)}
									</ul>
								</div>
							</div>
						);
					})}
				</div>
			) : (
				<div data-testid="heat-rows" role="tree" aria-label={t("sessionInsights.hotspots.tree")}>
					<ul role="none" className="flex flex-col">
						{rows(roots[0]?.children ?? [])}
					</ul>
				</div>
			)}
			{picked ? detail(picked) : null}
		</div>
	);
}
