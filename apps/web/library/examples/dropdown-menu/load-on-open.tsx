import { RiArrowDownSLine, RiGitCommitLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useRef, useState } from "react";

interface Commit {
	sha: string;
	subject: string;
	meta: string;
}

const COMMITS: Commit[] = [
	{
		sha: "4f2a9c1",
		subject: "Bound long menus to the viewport",
		meta: "4f2a9c1 · Julia · 2 h ago",
	},
	{ sha: "b81e07d", subject: "Share menu row geometry", meta: "b81e07d · Alex · yesterday" },
	{ sha: "09cd3aa", subject: "Add the Open in submenu", meta: "09cd3aa · Julia · 3 days ago" },
];

export default function LoadOnOpen() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [commits, setCommits] = useState<Commit[] | null>(null);
	const timer = useRef(0);
	const load = () => {
		setCommits(null);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setCommits(COMMITS), 1200);
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
				<Button variant="ghost" size="m" iconLeft={RiGitCommitLine} iconRight={RiArrowDownSLine}>
					{t("changes.scopeMenu.commits")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-[22rem]">
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
					commits.map((commit) => (
						<DropdownMenuItem key={commit.sha} onSelect={() => {}}>
							<RiGitCommitLine />
							<span className="flex min-w-0 flex-col">
								<span className="truncate">{commit.subject}</span>
								<span className="truncate tr-text-metadata text-text-muted">{commit.meta}</span>
							</span>
						</DropdownMenuItem>
					))
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
