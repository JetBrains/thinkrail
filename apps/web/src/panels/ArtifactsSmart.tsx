import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiToolsLine,
} from "@remixicon/react";
import type { WorkspaceArtifact } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useTreeItem } from "@thinkrail/ui/tree-item";
import { TreeRow } from "@thinkrail/ui/tree-row";
import { useAppStore } from "../store";
import { ArtifactFileRow, ArtifactTreeRows, type TreeRowContext } from "./ArtifactsTree";
import { NewDot } from "./artifactRowParts";
import { type ArtifactRow, artifactTree, type SmartGroup, type SmartView } from "./artifactsModel";

interface SmartContext extends TreeRowContext {
	dir: string;
	artifacts: readonly WorkspaceArtifact[];
}

export const SMART_UNATTACHED = "smart-unattached";
export const smartGroupId = (folder: string) => `smart:${folder}`;
const workingId = (folder: string) => `smart-work:${folder}`;

function toggle(workspaceId: string, id: string, open: boolean) {
	useAppStore.getState().setArtifactsTreeExpanded(workspaceId, [id], !open);
}

export function ArtifactsSmart({ view, ...context }: SmartContext & { view: SmartView }) {
	const t = useT();
	return (
		<>
			{view.groups.map((group) => (
				<SmartGroupRow key={group.folder} group={group} level={1} {...context} />
			))}
			{view.unattached.length ? (
				<WorkingFiles
					id={SMART_UNATTACHED}
					testid="artifact-unattached"
					label={t("panels.artifacts.unattached", { count: view.unattached.length })}
					rows={view.unattached}
					base=""
					level={1}
					separated
					{...context}
				/>
			) : null}
		</>
	);
}

function SmartGroupRow({
	group,
	level,
	...context
}: SmartContext & { group: SmartGroup; level: number }) {
	const t = useT();
	const id = smartGroupId(group.folder);
	const open = context.expanded.has(id);
	const results = t("panels.artifacts.results", { count: group.resultCount });
	return (
		<li
			role="none"
			data-testid="artifact-smart-group"
			data-folder={group.folder}
			data-focus-row={id}
		>
			<TreeRow
				testid="artifact-smart-group-row"
				treeId={id}
				level={level}
				kind="dir"
				expanded={open}
				label={group.name || t("panels.artifacts.topLevel")}
				onClick={() => toggle(context.workspaceId, id, open)}
				trailing={
					<span className="flex shrink-0 items-center gap-8 pr-4 tr-text-metadata">
						{!open && group.fresh ? <NewDot /> : null}
						<span data-testid="artifact-smart-summary" className="text-text-subtle">
							{group.groupCount
								? t("panels.artifacts.groupSummary", {
										results,
										groups: t("panels.artifacts.groups", { count: group.groupCount }),
									})
								: results}
						</span>
					</span>
				}
			/>
			{open ? (
				<ul
					role="none"
					data-focus-list={`artifacts:${id}`}
					className="flex flex-col pl-tree-indent"
				>
					{group.results.map((row) => (
						<ArtifactFileRow
							key={row.artifact.path}
							node={{ kind: "file", name: row.name, path: row.artifact.path, row }}
							level={level + 1}
							smart
							{...context}
						/>
					))}
					{group.children.map((child) => (
						<SmartGroupRow key={child.folder} group={child} level={level + 1} {...context} />
					))}
					{group.working.length ? (
						<WorkingFiles
							id={workingId(group.folder)}
							testid="artifact-working-files"
							label={t("panels.artifacts.workingFiles", { count: group.working.length })}
							rows={group.working}
							base={group.folder}
							level={level + 1}
							{...context}
						/>
					) : null}
				</ul>
			) : null}
		</li>
	);
}

function WorkingFiles({
	id,
	testid,
	label,
	rows,
	base,
	level,
	separated = false,
	dir,
	artifacts,
	...context
}: SmartContext & {
	id: string;
	testid: string;
	label: string;
	rows: readonly ArtifactRow[];
	base: string;
	level: number;
	separated?: boolean;
}) {
	const open = context.expanded.has(id);
	const item = useTreeItem(id, { level, label, expanded: open, toggles: true });
	return (
		<li
			role="none"
			data-focus-row={id}
			className={separated ? "mt-8 border-border-muted border-t pt-8" : undefined}
		>
			<div className="flex py-2 pl-4">
				<Button
					variant="soft-primary"
					size="s"
					iconLeft={RiToolsLine}
					iconRight={open ? ChevronDown : ChevronRight}
					selected={open}
					{...item}
					data-testid={testid}
					data-focus-row-primary
					onClick={() => toggle(context.workspaceId, id, open)}
				>
					{label}
				</Button>
			</div>
			{open ? (
				<ul
					role="none"
					data-focus-list={`artifacts:${id}`}
					className="flex flex-col pl-tree-indent"
				>
					<ArtifactTreeRows
						nodes={artifactTree(dir, rows, artifacts, base)}
						level={level + 1}
						{...context}
					/>
				</ul>
			) : null}
		</li>
	);
}
