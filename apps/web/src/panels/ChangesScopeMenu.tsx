import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiGitCommitLine as GitCommitHorizontal,
	RiGitPullRequestLine as GitCompare,
	RiRobot2Line as Robot,
} from "@remixicon/react";
import type { GitCommit, GitDiffScope } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useRef, useState } from "react";
import { useNow } from "@/components/useNow";
import { relativeTime, turnTimeLabel } from "@/lib";
import { getTransport } from "../transport";
import { scopeLabel, scopeTitle, turnScope } from "./changesModel";
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
	const t = useT();
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
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="m"
					iconLeft={GitCompare}
					iconRight={ChevronDown}
					data-testid="changes-scope-trigger"
					data-open={open}
					aria-label={t("changes.scopeMenu.label")}
					title={scopeTitle(t, scope, commits ?? [], turns)}
					className="min-w-0"
				>
					<span data-testid="changes-scope-label" className="truncate">
						{scopeLabel(t, scope, commits ?? [], turns)}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-[22rem]">
				<DropdownMenuItem
					data-testid="changes-scope-all"
					data-active={scope.kind === "branch" ? true : undefined}
					onSelect={() => onSelectScope({ kind: "branch" })}
				>
					<Check className={scope.kind === "branch" ? "" : "invisible"} />
					{t("changes.scope.all")}
				</DropdownMenuItem>
				<DropdownMenuItem
					data-testid="changes-scope-uncommitted"
					data-active={scope.kind === "uncommitted" ? true : undefined}
					disabled={hasUncommitted === false && scope.kind !== "uncommitted"}
					onSelect={() => onSelectScope({ kind: "uncommitted" })}
				>
					<Check className={scope.kind === "uncommitted" ? "" : "invisible"} />
					{hasUncommitted === false
						? t("changes.scopeMenu.noUncommitted")
						: t("changes.scopeMenu.uncommitted")}
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
						? t("changes.scopeMenu.lastTurnFiles", { count: latestTurn.changes.length })
						: t("changes.scopeMenu.noTurns")}
				</DropdownMenuItem>
				{turns.length > 1 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>{t("changes.scopeMenu.turns")}</DropdownMenuLabel>
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
													? t("changes.scope.lastTurn")
													: t("changes.scope.turn", { time: turnTimeLabel(t, turn.startedAt) })}
											</span>
											<span className="truncate tr-text-metadata text-text-muted">
												{t("changes.scopeMenu.turnMeta", {
													count: turn.changes.length,
													time: relativeTime(t, turn.settledAt, now),
												})}
											</span>
										</span>
									</DropdownMenuItem>
								);
							})}
					</>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuLabel>{t("changes.scopeMenu.commits")}</DropdownMenuLabel>
				{commits === null ? (
					<LoadingRegion
						rows={3}
						label={t("changes.scopeMenu.loadingCommits")}
						className="px-8 py-4"
					/>
				) : commits.length === 0 ? (
					<DropdownMenuItem disabled>{t("changes.scopeMenu.noCommits")}</DropdownMenuItem>
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
											? ` · ${relativeTime(t, Date.parse(commit.committedAt), now)}`
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
