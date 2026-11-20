import { RiArrowRightSLine as ChevronRight, RiFolderLine, RiStarFill } from "@remixicon/react";
import type { ArtifactRoleReason } from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { fileName, firstClickOnly } from "../lib";
import { useAppStore } from "../store";
import { openArtifact, restoreDeletedArtifact } from "./artifactActions";
import {
	ArtifactEntryMenu,
	artifactIcon,
	ChatChip,
	NewDot,
	type RequestRemoval,
} from "./artifactRowParts";
import {
	type ArtifactTreeFile,
	type ArtifactTreeFolder,
	type ArtifactTreeNode,
	artifactTimeLabel,
} from "./artifactsModel";
import { renameEntry } from "./fileTreeActions";
import { type OpenTabOptions, treeOpenFocus } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { treeRowControlProps } from "./treeNavigation";
import { useInlineRename } from "./workspaceActions";

function PickedBadge() {
	const t = useT();
	return (
		<span
			data-testid="artifact-picked"
			className="flex shrink-0 items-center gap-2 rounded-sm bg-primary-soft px-4 text-primary"
		>
			<RiStarFill className="size-12" />
			{t("panels.artifacts.picked")}
		</span>
	);
}

function reasonLabel(t: Translator, reason: ArtifactRoleReason): string {
	switch (reason) {
		case "picked":
			return t("panels.artifacts.reason.picked");
		case "shown":
			return t("panels.artifacts.reason.shown");
		case "linked":
			return t("panels.artifacts.reason.linked");
		default:
			return t("panels.artifacts.reason.document");
	}
}

export interface TreeRowContext {
	workspaceId: string;
	expanded: ReadonlySet<string>;
	activePath: string | null;
	showChat: boolean;
	onRemove: RequestRemoval;
}

export function ArtifactTreeRows({
	nodes,
	level = 1,
	...context
}: TreeRowContext & { nodes: readonly ArtifactTreeNode[]; level?: number }) {
	return nodes.map((node) =>
		node.kind === "dir" ? (
			<FolderRow key={`${node.path}/`} node={node} level={level} {...context} />
		) : (
			<ArtifactFileRow key={node.path} node={node} level={level} {...context} />
		),
	);
}

export function rowClass(selected: boolean, accent = false) {
	return cn(
		"flex min-w-0 items-center rounded-sm",
		accent && "border-primary border-l-2",
		selected
			? "bg-control-bg-selected"
			: accent
				? "bg-primary-subtle hover:bg-control-bg-hovered"
				: "hover:bg-control-bg-hovered",
	);
}

function RenameField({
	folder,
	icon,
	children,
}: {
	folder: boolean;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex h-panel-row min-w-0 flex-1 items-center gap-4 px-4">
			{folder ? (
				<ChevronRight className="size-16 shrink-0 text-text-muted" />
			) : (
				<span className="size-14 shrink-0" />
			)}
			{icon}
			{children}
		</div>
	);
}

const RENAME_INPUT =
	"w-full min-w-0 border-0 bg-transparent p-0 text-text-default tr-text-ui focus-visible:focus-ring";

function FolderRow({
	node,
	level,
	...context
}: TreeRowContext & { node: ArtifactTreeFolder; level: number }) {
	const t = useT();
	const { workspaceId, expanded } = context;
	const open = expanded.has(node.path);
	const name = fileName(node.path);
	const { editing, nameRef, start, inputProps, onMenuCloseAutoFocus } = useInlineRename({
		target: { id: node.path, name },
		canRename: !node.deleted,
		onRename: (_target, next) => void renameEntry(workspaceId, node.path, next),
	});
	return (
		<li
			role="none"
			data-testid="artifact-folder"
			data-path={node.path}
			data-focus-row={`${node.path}/`}
			data-deleted={node.deleted || undefined}
		>
			<ArtifactEntryMenu
				workspaceId={workspaceId}
				path={node.path}
				folder
				deleted={node.deleted}
				onRename={start}
				onCloseAutoFocus={onMenuCloseAutoFocus}
			>
				{(menuOpen, onRowKeyDown) => (
					<div role="none" className={rowClass(menuOpen)}>
						{editing ? (
							<RenameField
								folder
								icon={<RiFolderLine className="size-14 shrink-0 text-text-muted" />}
							>
								<input
									ref={nameRef}
									data-testid="artifact-name-input"
									type="text"
									spellCheck={false}
									aria-label={t("panels.artifacts.name")}
									defaultValue={name}
									{...inputProps}
									className={RENAME_INPUT}
								/>
							</RenameField>
						) : (
							<TreeRow
								testid="artifact-folder-row"
								treeId={`${node.path}/`}
								level={level}
								path={node.path}
								kind="dir"
								expanded={open}
								highlight="wrapper"
								label={node.name}
								labelClassName={node.deleted ? "text-text-subtle line-through" : undefined}
								onClick={() =>
									useAppStore.getState().setArtifactsTreeExpanded(workspaceId, node.paths, !open)
								}
								onKeyDown={onRowKeyDown}
								trailing={
									<span className="flex shrink-0 items-center gap-8 pr-4 tr-text-metadata">
										{!open && node.fresh ? <NewDot /> : null}
										{node.deleted ? (
											<span className="text-feedback-warning">
												{t("panels.artifacts.folderDeleted")}
											</span>
										) : null}
										<span data-testid="artifact-folder-files" className="text-text-subtle">
											{node.files}
										</span>
									</span>
								}
							/>
						)}
					</div>
				)}
			</ArtifactEntryMenu>
			{open ? (
				<ul
					role="none"
					data-focus-list={`artifacts:${node.path}`}
					className="flex flex-col pl-tree-indent"
				>
					<ArtifactTreeRows nodes={node.children} level={level + 1} {...context} />
				</ul>
			) : null}
		</li>
	);
}

export function ArtifactFileRow({
	node,
	level,
	workspaceId,
	activePath,
	showChat,
	onRemove,
	smart = false,
}: TreeRowContext & { node: ArtifactTreeFile; level: number; smart?: boolean }) {
	const t = useT();
	const { row } = node;
	const { artifact, taskSpecStatus, fresh } = row;
	const deleted = artifact.state === "deleted";
	const active = activePath === artifact.path;
	const picked = smart && artifact.reason === "picked";
	const time = artifactTimeLabel(t, artifact.changedAt);
	const title =
		smart && artifact.role === "result" && artifact.reason
			? t("panels.artifacts.reasonTitle", { reason: reasonLabel(t, artifact.reason), time })
			: time;
	const { editing, nameRef, start, inputProps, onMenuCloseAutoFocus } = useInlineRename({
		target: { id: artifact.path, name: node.name },
		canRename: !deleted,
		onRename: (_target, next) => void renameEntry(workspaceId, artifact.path, next),
	});
	const Icon = artifactIcon(row);
	const restore = () => void restoreDeletedArtifact(workspaceId, artifact);
	const open = (intent: "preview" | "keep", options?: OpenTabOptions) =>
		void openArtifact(workspaceId, artifact, intent, options);
	return (
		<li
			role="none"
			data-testid="artifact-row"
			data-path={artifact.path}
			data-focus-row={artifact.path}
			data-state={artifact.state}
			data-fresh={fresh || undefined}
		>
			<ArtifactEntryMenu
				workspaceId={workspaceId}
				path={artifact.path}
				deleted={deleted}
				onRestore={restore}
				sessionId={artifact.sessionId}
				onRename={start}
				onRemove={(path) => onRemove(path, deleted)}
				onCloseAutoFocus={onMenuCloseAutoFocus}
			>
				{(menuOpen, onRowKeyDown) => (
					<div
						role="none"
						title={title}
						data-picked={picked || undefined}
						className={rowClass(active || menuOpen, picked)}
					>
						{editing ? (
							<RenameField
								folder={false}
								icon={<Icon className="size-14 shrink-0 text-text-muted" />}
							>
								<input
									ref={nameRef}
									data-testid="artifact-name-input"
									type="text"
									spellCheck={false}
									aria-label={t("panels.artifacts.name")}
									defaultValue={node.name}
									{...inputProps}
									className={RENAME_INPUT}
								/>
							</RenameField>
						) : (
							<TreeRow
								testid="artifact-open"
								treeId={artifact.path}
								level={level}
								path={artifact.path}
								kind="file"
								icon={Icon}
								active={active}
								highlight="wrapper"
								label={node.name}
								labelClassName={deleted ? "text-text-subtle line-through" : undefined}
								onClick={firstClickOnly((event) => open("preview", treeOpenFocus(event)))}
								onDoubleClick={() => open("keep")}
								onKeyDown={onRowKeyDown}
								trailing={
									taskSpecStatus || fresh || picked ? (
										<span className="flex shrink-0 items-center gap-8 pr-4 tr-text-metadata">
											{picked ? <PickedBadge /> : null}
											{taskSpecStatus ? (
												<span data-testid="artifact-task-status" className="text-text-subtle">
													{taskSpecStatus}
												</span>
											) : null}
											{fresh ? <NewDot /> : null}
										</span>
									) : undefined
								}
							/>
						)}
						{deleted && !editing ? (
							<button
								type="button"
								data-testid="artifact-restore"
								{...treeRowControlProps}
								title={t("panels.artifacts.deleted")}
								onClick={restore}
								className="shrink-0 px-4 text-primary tr-text-metadata hover:underline"
							>
								{t("panels.artifacts.restore")}
							</button>
						) : null}
						{showChat && artifact.sessionId && !editing ? (
							<span className="flex min-w-0 max-w-[40%] shrink pr-4">
								<ChatChip workspaceId={workspaceId} sessionId={artifact.sessionId} />
							</span>
						) : null}
					</div>
				)}
			</ArtifactEntryMenu>
		</li>
	);
}
