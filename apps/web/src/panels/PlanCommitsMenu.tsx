import {
	RiArrowDownSLine as ChevronDown,
	RiGitCommitLine as GitCommitHorizontal,
} from "@remixicon/react";
import type { GitCommit } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { useNow } from "@/components/useNow";
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
	const t = useT();
	const now = useNow();
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
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="m"
					iconLeft={GitCommitHorizontal}
					iconRight={ChevronDown}
					data-testid="plan-commits-trigger"
					data-open={open}
					tooltip={t("plan.commitsMenu.title")}
					className="shrink-0"
				>
					{t("plan.commitsMenu.count", { count })}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent data-testid="plan-commits-menu" align="start" className="max-w-[24rem]">
				<DropdownMenuLabel>{t("plan.commitsMenu.label")}</DropdownMenuLabel>
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
								{commit.committedAt
									? ` · ${relativeTime(t, Date.parse(commit.committedAt), now)}`
									: ""}
							</span>
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
