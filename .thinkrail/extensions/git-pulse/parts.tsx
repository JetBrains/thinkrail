import { cn } from "@thinkrail/ext/view";
import type { ReactNode } from "react";
import { type Commit, type FetchResult, type FileChange, formatAgo } from "./model";

export const Empty = ({ title, detail }: { title: string; detail?: string }) => (
	<div
		data-testid="git-pulse-empty"
		className="flex h-full flex-col items-center justify-center gap-4 p-24 text-center"
	>
		<p className="tr-text-ui text-text-default">{title}</p>
		{detail && <p className="tr-text-metadata break-all text-text-muted">{detail}</p>}
	</div>
);

export const Chip = ({
	label,
	value,
	tone,
}: {
	label: string;
	value: number;
	tone: "success" | "warning" | "error" | "muted";
}) => (
	<span
		data-testid={`git-pulse-count-${label}`}
		className={cn(
			"flex items-center gap-4 rounded-sm border border-border-muted px-8 py-2 tr-text-metadata",
			value === 0 && "text-text-subtle",
			value > 0 && tone === "success" && "text-feedback-success",
			value > 0 && tone === "warning" && "text-feedback-warning",
			value > 0 && tone === "error" && "text-feedback-error",
			value > 0 && tone === "muted" && "text-text-default",
		)}
	>
		<span className="tabular-nums">{value}</span>
		<span className="text-text-muted">{label}</span>
	</span>
);

export const Section = ({
	title,
	meta,
	testId,
	children,
}: {
	title: string;
	meta?: string;
	testId: string;
	children: ReactNode;
}) => (
	<section
		data-testid={testId}
		className="flex min-h-0 min-w-0 flex-col rounded-md border border-border-muted bg-container-elevated-bg"
	>
		<header className="flex shrink-0 items-center gap-8 border-b border-border-muted px-12 py-8">
			<h3 className="tr-title-compact text-text-default">{title}</h3>
			{meta && <span className="ml-auto tr-text-metadata text-text-muted">{meta}</span>}
		</header>
		<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
	</section>
);

export const CommitRow = ({ commit, now }: { commit: Commit; now: number }) => (
	<li
		data-testid="git-pulse-commit"
		className="flex items-baseline gap-8 border-b border-border-muted px-12 py-4 last:border-b-0"
	>
		<span className="shrink-0 tr-code-text text-primary" title={commit.hash}>
			{commit.short}
		</span>
		<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default" title={commit.subject}>
			{commit.subject}
		</span>
		<span className="shrink-0 tr-text-metadata text-text-muted">
			{commit.author} · {formatAgo(Math.max(0, now - commit.time))}
		</span>
	</li>
);

const letter = (value: string) => (value === "." ? " " : value);

const FileBadge = ({ file }: { file: FileChange }) => {
	if (file.kind === "untracked")
		return <span className="w-24 shrink-0 tr-code-text text-text-subtle">??</span>;
	if (file.kind === "conflicted")
		return <span className="w-24 shrink-0 tr-code-text text-feedback-error">!!</span>;
	return (
		<span className="w-24 shrink-0 whitespace-pre tr-code-text">
			<span className="text-feedback-success">{letter(file.index)}</span>
			<span className="text-feedback-warning">{letter(file.worktree)}</span>
		</span>
	);
};

export const FileRow = ({ file }: { file: FileChange }) => (
	<li
		data-testid="git-pulse-file"
		data-kind={file.kind}
		className="flex items-baseline gap-8 border-b border-border-muted px-12 py-4 last:border-b-0"
	>
		<FileBadge file={file} />
		<span className="min-w-0 flex-1 truncate tr-code-text text-text-default" title={file.path}>
			{file.from ? `${file.from} → ${file.path}` : file.path}
		</span>
	</li>
);

export const FetchLine = ({ result, now }: { result: FetchResult; now: number }) => (
	<div
		data-testid="git-pulse-fetch-result"
		data-ok={result.ok}
		className={cn(
			"flex flex-col gap-4 rounded-md border px-12 py-8",
			result.ok
				? "border-border-muted bg-feedback-success-subtle"
				: "border-border-muted bg-feedback-error-subtle",
		)}
	>
		<span
			className={cn(
				"tr-text-metadata",
				result.ok ? "text-feedback-success" : "text-feedback-error",
			)}
		>
			{result.ok ? "Fetched" : "Fetch failed"} · {formatAgo(Math.max(0, now - result.at))}
		</span>
		<pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all tr-code-text text-text-default">
			{result.output}
		</pre>
	</div>
);
