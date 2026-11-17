import {
	RiArrowLeftLine as ArrowLeft,
	RiExternalLinkLine as ExternalLink,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type { WikiPageEntry, WikiStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type ComponentProps, useMemo, useState } from "react";
import { Markdown } from "@/chat/Markdown";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { useWikiArticle, useWikiStatus } from "./useRepoWiki";
import { WikiBuildPanel } from "./WikiBuildPanel";
import { WikiPublishControl } from "./WikiPublishControl";
import { resolveWikiLink } from "./wikiLinks";
import { useWikiPageState } from "./wikiPageState";

const WIKI_ENTRY = "index.md";
const WIKI_PROSE = "tr-prose-doc max-w-none break-words text-pretty text-text-default";

function PageList({
	pages,
	selected,
	onSelect,
}: {
	pages: readonly WikiPageEntry[];
	selected: string;
	onSelect: (path: string) => void;
}) {
	const t = useT();
	const [filter, setFilter] = useState("");
	const needle = filter.trim().toLowerCase();
	const shown = needle
		? pages.filter((page) => `${page.title} ${page.path}`.toLowerCase().includes(needle))
		: pages;
	return (
		<nav
			aria-label={t("panels.wiki.pages.label")}
			data-testid="wiki-pages"
			className="flex max-h-160 w-full shrink-0 flex-col border-border-default border-b bg-container-sidebar-bg sm:max-h-none sm:w-240 sm:border-r sm:border-b-0"
		>
			<input
				type="search"
				value={filter}
				onChange={(event) => setFilter(event.target.value)}
				placeholder={t("panels.wiki.pages.filter")}
				aria-label={t("panels.wiki.pages.filter")}
				data-testid="wiki-filter"
				className="m-8 rounded-sm border border-border-default bg-container-content-bg px-8 py-4 tr-text-ui text-text-default placeholder:text-text-subtle focus-visible:focus-ring"
			/>
			<QuietScrollArea className="min-h-0 flex-1" viewportClassName="px-8 pb-8">
				{shown.length === 0 ? (
					<p className="px-8 py-4 tr-text-metadata text-text-muted">
						{t("panels.wiki.pages.none")}
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{shown.map((page) => (
							<li key={page.path}>
								<button
									type="button"
									data-testid="wiki-page-row"
									data-path={page.path}
									aria-current={page.path === selected ? "page" : undefined}
									onClick={() => onSelect(page.path)}
									className={cn(
										"w-full truncate rounded-sm px-8 py-4 text-left tr-text-ui text-text-default hover:bg-container-elevated-bg focus-visible:focus-ring",
										page.path === selected && "bg-primary-subtle",
									)}
								>
									{page.title}
								</button>
							</li>
						))}
					</ul>
				)}
			</QuietScrollArea>
		</nav>
	);
}

function Article({
	workspaceId,
	path,
	revision,
	onNavigate,
}: {
	workspaceId: string;
	path: string;
	revision: number | undefined;
	onNavigate: (path: string) => void;
}) {
	const t = useT();
	const { article, failed } = useWikiArticle(workspaceId, path, revision);
	const components = useMemo<ComponentProps<typeof Markdown>["components"]>(
		() => ({
			a: ({ href, children }) => {
				const target = resolveWikiLink(path, href);
				if (target.kind === "page") {
					return (
						<a
							href={href}
							data-testid="wiki-link"
							onClick={(event) => {
								event.preventDefault();
								onNavigate(target.path);
							}}
						>
							{children}
						</a>
					);
				}
				if (target.kind === "external") {
					return (
						<a href={target.href} target="_blank" rel="noreferrer noopener">
							{children}
						</a>
					);
				}
				if (target.kind === "anchor") return <a href={href}>{children}</a>;
				return <span>{children}</span>;
			},
		}),
		[path, onNavigate],
	);

	if (failed) {
		return (
			<p data-testid="wiki-article-failed" className="px-24 py-16 tr-text-ui text-text-muted">
				{t("panels.wiki.article.failed")}
			</p>
		);
	}
	if (!article) return <LoadingRegion rows={8} className="px-24 py-16" />;
	return (
		<article data-testid="wiki-article" data-path={article.path} className="px-24 py-16">
			<Markdown text={article.content} className={WIKI_PROSE} components={components} />
		</article>
	);
}

function PublicationLine({ status }: { status: WikiStatus }) {
	const t = useT();
	if (!status.publication) return null;
	return (
		<a
			href={status.publication.url}
			target="_blank"
			rel="noreferrer noopener"
			data-testid="wiki-publication"
			className="inline-flex items-center gap-4 tr-text-metadata text-primary underline"
		>
			{t("panels.wiki.publication", {
				time: new Date(status.publication.publishedAt).toLocaleString(),
			})}
			<ExternalLink className="size-12" aria-hidden="true" />
		</a>
	);
}

export function WikiPage({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const { status, failed, reload } = useWikiStatus(workspaceId);
	const [selected, setSelected] = useState(WIKI_ENTRY);
	const [showBuild, setShowBuild] = useState(false);
	const built = status?.built === true;

	return (
		<div
			data-testid="wiki-page"
			className="absolute inset-0 z-10 flex min-h-0 flex-col bg-container-workspace-bg"
		>
			<header className="flex flex-wrap items-center gap-12 border-border-default border-b px-16 py-8">
				<IconButton
					variant="ghost"
					size="m"
					icon={ArrowLeft}
					label={t("panels.wiki.back")}
					tooltip={t("panels.wiki.back")}
					data-testid="wiki-back"
					onClick={() => useWikiPageState.getState().close()}
				/>
				<div className="flex min-w-0 flex-1 flex-col">
					<h1 className="truncate tr-text-emphasis text-text-default">{t("panels.wiki.title")}</h1>
					<span data-testid="wiki-meta" className="tr-text-metadata text-text-muted">
						{built && status
							? t("panels.wiki.meta", {
									count: status.pages.length,
									time: status.builtAt ? new Date(status.builtAt).toLocaleString() : "",
								})
							: t("panels.wiki.notBuilt")}
					</span>
					{status ? <PublicationLine status={status} /> : null}
				</div>
				<IconButton
					variant="ghost"
					size="m"
					icon={RefreshCw}
					label={t("panels.wiki.refresh")}
					tooltip={t("panels.wiki.refresh")}
					data-testid="wiki-refresh"
					onClick={reload}
				/>
				<Button
					variant={built ? "outline" : "primary"}
					data-testid="wiki-build-toggle"
					onClick={() => setShowBuild((value) => !value)}
				>
					{built ? t("panels.wiki.rebuild") : t("panels.wiki.build.title")}
				</Button>
				{status ? (
					<WikiPublishControl workspaceId={workspaceId} status={status} onPublished={reload} />
				) : null}
			</header>
			{showBuild || (status !== null && !built) ? (
				<WikiBuildPanel workspaceId={workspaceId} />
			) : null}
			{failed && status === null ? (
				<p data-testid="wiki-failed" className="px-16 py-16 tr-text-ui text-text-muted">
					{t("panels.wiki.loadFailed")}
				</p>
			) : status === null ? (
				<LoadingRegion rows={6} className="px-16 py-16" />
			) : built ? (
				<div className="flex min-h-0 flex-1 flex-col sm:flex-row">
					<PageList pages={status.pages} selected={selected} onSelect={setSelected} />
					<QuietScrollArea className="min-w-0 flex-1" viewportClassName="h-full">
						<Article
							workspaceId={workspaceId}
							path={selected}
							revision={status.builtAt}
							onNavigate={setSelected}
						/>
					</QuietScrollArea>
				</div>
			) : (
				<p data-testid="wiki-empty" className="px-16 py-16 tr-text-ui text-text-muted">
					{t("panels.wiki.empty")}
				</p>
			)}
		</div>
	);
}
