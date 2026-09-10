import {
	RiArrowDownSLine as ChevronDown,
	RiGitCommitLine as GitCommitHorizontal,
} from "@remixicon/react";
import type { GitCommit } from "@thinkrail/contracts";
import { useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib";
import { getTransport } from "../transport";

export function PlanCommitsMenu({
	workspaceId,
	reloadSignal,
	onOpenCommit,
}: {
	workspaceId: string;
	reloadSignal: number;
	onOpenCommit: (sha: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [commits, setCommits] = useState<GitCommit[] | null>(null);
	const generation = useRef(0);

	useEffect(() => {
		const mine = ++generation.current;
		const live = () => generation.current === mine;
		void getTransport()
			.request("git.listCommits", { workspaceId })
			.then(({ commits: list }) => {
				if (live()) setCommits(list);
			})
			.catch(() => {
				if (live()) setCommits([]);
			});
	}, [workspaceId, reloadSignal]);

	if (commits === null || commits.length === 0) return null;
	const count = commits.length;

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger
				data-testid="plan-commits-trigger"
				data-open={open}
				title="Commits on this branch"
				className="flex h-24 shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 tr-text-metadata text-text-subtle outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected data-[open=true]:text-text-default"
			>
				<GitCommitHorizontal className="size-12 shrink-0" />
				<span>
					{count} {count === 1 ? "commit" : "commits"}
				</span>
				<ChevronDown className="size-14 shrink-0" />
			</DropdownMenuTrigger>
			<DropdownMenuContent data-testid="plan-commits-menu" align="start" className="max-w-[24rem]">
				<DropdownMenuLabel>Commits</DropdownMenuLabel>
				{commits.map((commit) => (
					<DropdownMenuItem
						key={commit.sha}
						data-testid="plan-commits-item"
						data-sha={commit.sha}
						onSelect={() => onOpenCommit(commit.sha)}
					>
						<GitCommitHorizontal />
						<span className="flex min-w-0 flex-col">
							<span className="truncate">{commit.subject || commit.shortSha}</span>
							<span className="truncate tr-text-metadata text-text-muted">
								{commit.shortSha} · {commit.author}
								{commit.committedAt ? ` · ${relativeTime(Date.parse(commit.committedAt))}` : ""}
							</span>
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
