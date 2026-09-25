import { remixicon, type SurfaceProps, ui, useAction } from "@thinkrail/ext/view";
import { useFetch, useNow, usePulse } from "./hooks";
import { headLabel, type Pulse } from "./model";
import { Chip, CommitRow, Empty, FetchLine, FileRow, Section } from "./parts";

const { RiGitBranchLine, RiRefreshLine, RiDownloadCloud2Line, RiLoader4Line } = remixicon;

type Ready = Extract<Pulse, { state: "ready" }>;

const upstreamText = (pulse: Ready) => {
	const { upstream, head } = pulse;
	if (head.kind === "detached") return "Detached HEAD: not on a branch.";
	if (head.kind === "unborn") return "No commits yet.";
	if (!upstream) return "No upstream branch.";
	if (upstream.gone) return `Tracking ${upstream.name} (gone on the remote).`;
	return `Tracking ${upstream.name}`;
};

const Header = ({ pulse, workspaceId }: { pulse: Ready; workspaceId: string }) => {
	const refresh = useAction("refresh");
	const fetch = useFetch(workspaceId);
	const now = useNow();
	const { upstream, counts } = pulse;
	return (
		<div className="flex shrink-0 flex-col gap-12 border-b border-border-muted px-16 py-12">
			<div className="flex items-center gap-8">
				<RiGitBranchLine className="size-16 shrink-0 text-primary" />
				<h2
					data-testid="git-pulse-head"
					data-kind={pulse.head.kind}
					className="min-w-0 truncate tr-title-section text-text-default"
				>
					{headLabel(pulse.head)}
				</h2>
				{upstream && !upstream.gone && (
					<span
						data-testid="git-pulse-ahead-behind"
						className="shrink-0 rounded-sm bg-control-bg px-8 py-2 tr-text-metadata tabular-nums text-text-default"
					>
						↑{upstream.ahead} ↓{upstream.behind}
					</span>
				)}
				<span className="ml-auto" />
				<ui.IconTooltip label="Refresh">
					<ui.Button
						variant="ghost"
						size="icon"
						aria-label="Refresh"
						onClick={() => void refresh().catch(() => {})}
					>
						<RiRefreshLine className="size-14" />
					</ui.Button>
				</ui.IconTooltip>
				<ui.Button
					variant="outline"
					size="sm"
					data-testid="git-pulse-fetch"
					disabled={fetch.running}
					onClick={fetch.run}
				>
					{fetch.running ? (
						<RiLoader4Line className="size-14 animate-spin" />
					) : (
						<RiDownloadCloud2Line className="size-14" />
					)}
					Fetch
				</ui.Button>
			</div>
			<p className="tr-text-metadata text-text-muted">
				{upstreamText(pulse)} <span className="break-all text-text-subtle">· {pulse.path}</span>
			</p>
			<div className="flex flex-wrap items-center gap-8">
				<Chip label="staged" value={counts.staged} tone="success" />
				<Chip label="unstaged" value={counts.unstaged} tone="warning" />
				<Chip label="untracked" value={counts.untracked} tone="muted" />
				{counts.conflicted > 0 && (
					<Chip label="conflicted" value={counts.conflicted} tone="error" />
				)}
				<Chip label="stashed" value={pulse.stash} tone="muted" />
			</div>
			{fetch.result && <FetchLine result={fetch.result} now={now} />}
		</div>
	);
};

const Body = ({ pulse }: { pulse: Ready }) => {
	const now = useNow();
	const hidden = pulse.filesTotal - pulse.files.length;
	return (
		<div className="grid min-h-0 flex-1 grid-rows-2 gap-12 p-16 lg:grid-cols-2 lg:grid-rows-1">
			<Section
				testId="git-pulse-commits"
				title="Recent commits"
				meta={`${pulse.commits.length} shown`}
			>
				{pulse.commits.length === 0 ? (
					<Empty title="No commits yet." />
				) : (
					<ul>
						{pulse.commits.map((commit) => (
							<CommitRow key={commit.hash} commit={commit} now={now} />
						))}
					</ul>
				)}
			</Section>
			<Section
				testId="git-pulse-files"
				title="Changed files"
				meta={hidden > 0 ? `${pulse.filesTotal} total, ${hidden} hidden` : `${pulse.filesTotal}`}
			>
				{pulse.files.length === 0 ? (
					<Empty title="Working tree clean." />
				) : (
					<ul>
						{pulse.files.map((file) => (
							<FileRow key={`${file.kind}:${file.path}`} file={file} />
						))}
					</ul>
				)}
			</Section>
		</div>
	);
};

const Dashboard = ({ host }: SurfaceProps) => {
	const { workspaceId } = host;
	const pulse = usePulse(workspaceId);
	if (!workspaceId) return <Empty title="Open a workspace to see its git state." />;
	return (
		<div
			data-testid="git-pulse-dashboard"
			data-state={pulse?.state ?? "loading"}
			className="flex h-full flex-col bg-container-workspace-bg"
		>
			{!pulse || pulse.state === "loading" ? (
				<Empty title="Reading git status…" />
			) : pulse.state === "not-git" ? (
				<Empty title="Not a git repository." detail={pulse.path} />
			) : pulse.state === "error" ? (
				<Empty title="Git failed." detail={pulse.message} />
			) : (
				<>
					<Header pulse={pulse} workspaceId={workspaceId} />
					<Body pulse={pulse} />
				</>
			)}
		</div>
	);
};

export default Dashboard;
