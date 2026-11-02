import {
	RiFolderFill,
	RiFolderLine,
	RiFolderOpenFill,
	RiFolderOpenLine,
	RiGitBranchFill,
	RiGitBranchLine,
	RiHome2Fill,
	RiHome2Line,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { RunningIcon } from "./running-icon";
import { cn } from "./utils";

/** A project's identity glyph in the project tree: the folder, or the running badge while one of its sessions works. */
export function ProjectGlyph({
	selected,
	running,
	className,
}: {
	selected: boolean;
	running: boolean;
	className?: string;
}) {
	const tone = selected ? "text-primary" : "text-text-muted";
	if (running) return <RunningIcon className={cn("size-14", tone, className)} />;
	const Folder = selected ? RiFolderFill : RiFolderLine;
	return <Folder className={cn("size-14 shrink-0", tone, className)} />;
}

/** A workspace's identity glyph: home for Default, an open folder for an external folder, a branch for a worktree. */
export function WorkspaceGlyph({
	kind,
	active,
	running,
	twoLine,
	className,
}: {
	kind: Workspace["kind"];
	active: boolean;
	running: boolean;
	twoLine: boolean;
	className?: string;
}) {
	const tone = active ? "text-primary" : "text-text-muted";
	if (running) return <RunningIcon className={cn("size-14", twoLine && "mt-2", tone, className)} />;
	const Icon =
		kind === "default"
			? active
				? RiHome2Fill
				: RiHome2Line
			: kind === "external"
				? active
					? RiFolderOpenFill
					: RiFolderOpenLine
				: active
					? RiGitBranchFill
					: RiGitBranchLine;
	return <Icon className={cn(twoLine && "mt-2", "size-14 shrink-0", tone, className)} />;
}

export function WorkspaceBranch({ branch }: { branch: string }) {
	return (
		<span
			data-testid="workspace-branch"
			className="truncate text-text-subtle tr-text-metadata leading-tight"
		>
			{branch}
		</span>
	);
}

/** A workspace's name with its branch as the second line when the two differ. */
export function WorkspaceLabel({
	name,
	branch,
	active,
}: {
	name: string;
	branch: string | undefined;
	active: boolean;
}) {
	return (
		<span className="flex min-w-0 flex-1 flex-col">
			<span
				data-testid="workspace-name"
				className={`truncate tr-text-ui leading-tight ${active ? "text-primary" : "text-text-muted"}`}
			>
				{name}
			</span>
			{branch ? <WorkspaceBranch branch={branch} /> : null}
		</span>
	);
}
