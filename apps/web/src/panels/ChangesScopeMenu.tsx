import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiGitCommitLine as GitCommitHorizontal,
	RiGitPullRequestLine as GitCompare,
	RiRobot2Line as Robot,
} from "@remixicon/react";
import type { GitCommit, GitDiffScope } from "@thinkrail/contracts";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useRef, useState } from "react";
import { LoadingRegion } from "@/components/Skeleton";
import { useNow } from "@/components/useNow";
import { relativeTime } from "@/lib";
import { getTransport } from "../transport";
import { scopeLabel, scopeTitle, turnScope, turnTimeLabel } from "./changesModel";
import { useWorkspaceTurns } from "./useWorkspaceTurns";

export function ChangesScopeMenu({
	workspaceId,
	scope,
	onSelectScope,
}: {
	workspaceId: string;
	scope: GitDiffScope;
	onSelectScope: (scope: GitDiffScope) => void;
}) {
	const now = useNow();
	const [open, setOpen] = useState(false);
	const [commits, setCommits] = useState<GitCommit[] | null>(null);
	const [hasUncommitted, setHasUncommitted] = useState<boolean | null>(null);

	const generation = useRef(0);
	const turns = useWorkspaceTurns(workspaceId);
	const latestTurn = turns.at(-1);

	const load = () => {
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
		void getTransport()
			.request("git.status", { workspaceId, scope: { kind: "uncommitted" } })
			.then(({ changes }) => {
				if (live()) setHasUncommitted(changes.length > 0);
			})
			.catch(() => {
				if (live()) setHasUncommitted(null);
			});
	};

	return (
		<DropdownMenu
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) load();
			}}
		>
			<DropdownMenuTrigger
				data-testid="changes-scope-trigger"
				data-open={open}
				aria-label="Diff scope"
				title={scopeTitle(scope, commits ?? [], turns)}
				className="flex h-24 min-w-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected data-[open=true]:text-text-default"
			>
				<GitCompare className="size-14 shrink-0" />
				<span data-testid="changes-scope-label" className="truncate">
					{scopeLabel(scope, commits ?? [], turns)}
				</span>
				<ChevronDown className="size-16 shrink-0" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-[22rem]">
				<DropdownMenuItem
					data-testid="changes-scope-all"
					data-active={scope.kind === "branch" ? true : undefined}
					onSelect={() => onSelectScope({ kind: "branch" })}
				>
					<Check className={scope.kind === "branch" ? "" : "invisible"} />
					All changes
				</DropdownMenuItem>
				<DropdownMenuItem
					data-testid="changes-scope-uncommitted"
					data-active={scope.kind === "uncommitted" ? true : undefined}
					disabled={hasUncommitted === false && scope.kind !== "uncommitted"}
					onSelect={() => onSelectScope({ kind: "uncommitted" })}
				>
					<Check className={scope.kind === "uncommitted" ? "" : "invisible"} />
					{hasUncommitted === false ? "No uncommitted changes" : "Uncommitted changes"}
				</DropdownMenuItem>
				<DropdownMenuItem
					data-testid="changes-scope-last-turn"
					data-active={scope.kind === "turn" && scope.id === latestTurn?.id ? true : undefined}
					disabled={latestTurn === undefined}
					onSelect={() => {
						if (latestTurn) onSelectScope(turnScope(latestTurn));
					}}
				>
					<Check
						className={scope.kind === "turn" && scope.id === latestTurn?.id ? "" : "invisible"}
					/>
					<Robot />
					{latestTurn
						? `Last turn · ${latestTurn.changes.length} ${latestTurn.changes.length === 1 ? "file" : "files"}`
						: "No agent turn changed files yet"}
				</DropdownMenuItem>
				{turns.length > 1 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Agent turns</DropdownMenuLabel>
						{[...turns]
							.reverse()
							.slice(0, 10)
							.map((turn) => {
								const active = scope.kind === "turn" && scope.id === turn.id;
								return (
									<DropdownMenuItem
										key={turn.id}
										data-testid="changes-scope-turn"
										data-turn={turn.id}
										data-active={active ? true : undefined}
										onSelect={() => onSelectScope(turnScope(turn))}
									>
										<Check className={active ? "" : "invisible"} />
										<Robot />
										<span className="flex min-w-0 flex-col">
											<span className="truncate">
												{turn.id === latestTurn?.id
													? "Last turn"
													: `Turn ${turnTimeLabel(turn.startedAt)}`}
											</span>
											<span className="truncate tr-text-metadata text-text-muted">
												{turn.changes.length} {turn.changes.length === 1 ? "file" : "files"} ·{" "}
												{relativeTime(turn.settledAt, now)}
											</span>
										</span>
									</DropdownMenuItem>
								);
							})}
					</>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Commits</DropdownMenuLabel>
				{commits === null ? (
					<LoadingRegion rows={3} label="Loading commits" className="px-8 py-4" />
				) : commits.length === 0 ? (
					<DropdownMenuItem disabled>No commits on this branch</DropdownMenuItem>
				) : (
					commits.map((commit) => {
						const active = scope.kind === "commit" && scope.sha === commit.sha;
						return (
							<DropdownMenuItem
								key={commit.sha}
								data-testid="changes-scope-commit"
								data-sha={commit.sha}
								data-active={active ? true : undefined}
								onSelect={() => onSelectScope({ kind: "commit", sha: commit.sha })}
							>
								<Check className={active ? "" : "invisible"} />
								<GitCommitHorizontal />
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{commit.subject || commit.shortSha}</span>
									<span className="truncate tr-text-metadata text-text-muted">
										{commit.shortSha} · {commit.author}
										{commit.committedAt
											? ` · ${relativeTime(Date.parse(commit.committedAt), now)}`
											: ""}
									</span>
								</span>
							</DropdownMenuItem>
						);
					})
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
