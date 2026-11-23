import { RiInboxLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { outputFileIcon } from "@thinkrail/resource-renderers";
import { Button } from "@thinkrail/ui/button";
import { useTreeItem } from "@thinkrail/ui/tree-item";
import { cn } from "@thinkrail/ui/utils";
import { firstClickOnly } from "../lib";
import { openArtifact } from "./artifactActions";
import { ArtifactEntryMenu, type RequestRemoval } from "./artifactRowParts";
import { artifactTimeLabel, type OutputEntry } from "./artifactsModel";
import { renameEntry } from "./fileTreeActions";
import { type OpenTabOptions, treeOpenFocus } from "./openTabs";
import { useInlineRename } from "./workspaceActions";

export function ArtifactsOutputs({
	entries,
	dir,
	workspaceId,
	activePath,
	onRemove,
}: {
	entries: readonly OutputEntry[];
	dir: string;
	workspaceId: string;
	activePath: string | null;
	onRemove: RequestRemoval;
}) {
	return entries.map((entry) => (
		<OutputFileRow
			key={entry.row.artifact.path}
			entry={entry}
			dir={dir}
			workspaceId={workspaceId}
			active={activePath === entry.row.artifact.path}
			onRemove={onRemove}
		/>
	));
}

function OutputFileRow({
	entry,
	dir,
	workspaceId,
	active,
	onRemove,
}: {
	entry: OutputEntry;
	dir: string;
	workspaceId: string;
	active: boolean;
	onRemove: RequestRemoval;
}) {
	const t = useT();
	const { row, name, type, folder } = entry;
	const { artifact } = row;
	const { editing, nameRef, start, inputProps, onMenuCloseAutoFocus } = useInlineRename({
		target: { id: artifact.path, name: row.name },
		canRename: true,
		onRename: (_target, next) => void renameEntry(workspaceId, artifact.path, next),
	});
	const treeItem = useTreeItem(artifact.path, {
		level: 1,
		label: name,
		selected: active,
		openKept: true,
	});
	const Icon = outputFileIcon(artifact.path);
	const open = (intent: "preview" | "keep", options?: OpenTabOptions) =>
		void openArtifact(workspaceId, artifact, intent, options);
	const inside = artifact.path.startsWith(`${dir}/`)
		? artifact.path.slice(dir.length + 1)
		: artifact.path;
	return (
		<li
			role="none"
			data-testid="artifact-output-file"
			data-path={artifact.path}
			data-focus-row={artifact.path}
		>
			<ArtifactEntryMenu
				workspaceId={workspaceId}
				path={artifact.path}
				sessionId={artifact.sessionId}
				onRename={start}
				onRemove={(path) => onRemove(path, false)}
				onCloseAutoFocus={onMenuCloseAutoFocus}
			>
				{(menuOpen, onRowKeyDown) => (
					<div
						role="none"
						title={t("panels.artifacts.outputTitle", {
							path: inside,
							time: artifactTimeLabel(t, artifact.changedAt),
						})}
						className={cn(
							"group/output flex h-32 min-w-0 items-center gap-12 rounded-sm px-8",
							menuOpen || active ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
						)}
					>
						<Icon className="size-16 shrink-0 text-text-muted" />
						{editing ? (
							<input
								ref={nameRef}
								data-testid="artifact-name-input"
								type="text"
								spellCheck={false}
								aria-label={t("panels.artifacts.name")}
								defaultValue={row.name}
								{...inputProps}
								className="w-full min-w-0 border-0 bg-transparent p-0 text-text-default tr-text-ui focus-visible:focus-ring"
							/>
						) : (
							<button
								type="button"
								{...treeItem}
								data-testid="artifact-open"
								data-focus-row-primary
								onClick={firstClickOnly((event) => open("preview", treeOpenFocus(event)))}
								onDoubleClick={() => open("keep")}
								onKeyDown={onRowKeyDown}
								className="flex h-full min-w-0 flex-1 items-center gap-8 text-left focus-visible:focus-ring-inset"
							>
								<span
									className={cn(
										"min-w-0 shrink truncate tr-text-ui",
										menuOpen || active
											? "text-text-default"
											: "text-text-muted group-hover/output:text-text-default",
									)}
								>
									{name}
								</span>
								<span
									data-testid="artifact-output-folder"
									className="min-w-0 flex-1 truncate text-text-subtle tr-text-metadata"
								>
									{folder}
								</span>
								<span
									data-testid="artifact-output-type"
									className="shrink-0 text-text-muted tr-text-metadata"
								>
									{type ?? t("resources.outputFile.type")}
								</span>
							</button>
						)}
					</div>
				)}
			</ArtifactEntryMenu>
		</li>
	);
}

export function EmptyOutputs({ files, onShowAll }: { files: number; onShowAll: () => void }) {
	const t = useT();
	return (
		<div
			data-testid="artifacts-outputs-empty"
			className="flex flex-col items-center gap-8 px-16 py-24 text-center"
		>
			<RiInboxLine className="size-20 text-text-subtle" />
			<p className="text-text-default tr-text-ui">{t("panels.artifacts.outputsEmpty")}</p>
			<p className="text-text-muted tr-text-metadata">{t("panels.artifacts.outputsEmptyHint")}</p>
			<Button variant="ghost" size="m" data-testid="artifacts-outputs-show-all" onClick={onShowAll}>
				{t("panels.artifacts.outputsShowAll", { count: files })}
			</Button>
		</div>
	);
}
