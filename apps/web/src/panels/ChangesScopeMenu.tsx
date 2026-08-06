import type { GitCommit, GitDiffScope } from "@thinkrail/contracts";
import { Check, ChevronDown, GitCommitHorizontal, GitCompare } from "lucide-react";
import { useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib";
import { getTransport } from "../transport";
import { scopeLabel, scopeTitle } from "./changesModel";

/**
 * The Changes header's **scope selector** — what is being diffed: everything on the branch, only what is
 * uncommitted, or a single commit. (The *target branch* that the branch scope measures against is its own
 * header control, the shared `BranchPicker` — a searchable list belongs in a combobox, and a nested submenu
 * closes itself when the menu re-renders as these lazy reads land.)
 *
 * Everything but the current scope is loaded **lazily on each open** (never on panel mount): the branch's
 * commits, and whether there is anything uncommitted at all (a read whose only job is to tell the user
 * *before* they pick an empty scope). Each degrades on its own — a failed commit read still leaves the
 * other scopes selectable. Both are **generation-stamped**: two opens in a row (or an open during a slow
 * read) must not let the earlier response overwrite the later one — the same discipline `useWorkspaceRead`
 * applies to the tick-driven reads this pair deliberately isn't part of.
 *
 * The menu's *identity* is `(workspaceId, baseRef)`, enforced by the caller's `key`: the commit rows are
 * `git log <base>..HEAD`, so re-pointing the target changes which commits exist — keeping them would offer
 * rows measured against a base that is no longer the workspace's.
 */
export function ChangesScopeMenu({
	workspaceId,
	scope,
	onSelectScope,
}: {
	workspaceId: string;
	scope: GitDiffScope;
	onSelectScope: (scope: GitDiffScope) => void;
}) {
	const [open, setOpen] = useState(false);
	const [commits, setCommits] = useState<GitCommit[] | null>(null);
	// `null` until known: whether the worktree has any uncommitted change (drives the empty-scope hint).
	const [hasUncommitted, setHasUncommitted] = useState<boolean | null>(null);

	// Stamps each open's pair of reads, so only the latest open's answers land (a slow first read can't
	// overwrite a newer one's rows).
	const generation = useRef(0);

	// Re-read on every open, not once: commits land, files change, and a stale list would offer a scope the
	// repo no longer has. The previous answer stays on screen until the fresh one replaces it.
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
				title={scopeTitle(scope, commits ?? [])}
				className="flex h-6 min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected data-[open=true]:text-text-default"
			>
				<GitCompare className="size-3.5 shrink-0" />
				<span data-testid="changes-scope-label" className="truncate">
					{scopeLabel(scope, commits ?? [])}
				</span>
				<ChevronDown className="size-3 shrink-0" />
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
					// Nothing dirty → the scope is offered but visibly inert, saying so instead of opening an
					// unexplained empty list. Unknown (`null`, a failed probe) stays selectable.
					disabled={hasUncommitted === false && scope.kind !== "uncommitted"}
					onSelect={() => onSelectScope({ kind: "uncommitted" })}
				>
					<Check className={scope.kind === "uncommitted" ? "" : "invisible"} />
					{hasUncommitted === false ? "No uncommitted changes" : "Uncommitted changes"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Commits</DropdownMenuLabel>
				{commits === null ? (
					<DropdownMenuItem disabled>Loading commits…</DropdownMenuItem>
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
										{commit.committedAt ? ` · ${relativeTime(Date.parse(commit.committedAt))}` : ""}
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
