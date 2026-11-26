import { RiArrowDownSLine as ChevronDown, RiAlertLine as TriangleAlert } from "@remixicon/react";
import type { PullRequestScope, PullRequestSummary } from "@thinkrail/contracts";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type Ref, type RefObject, useState } from "react";
import { ArgumentCompletionFrame, ArgumentCompletionMenu } from "../prompt";
import type { PullRequestCompletion } from "./pullRequestCompletion";

const NOTICE = "px-8 py-8 text-text-muted tr-text-ui";
const CHIP =
	"rounded-full border px-8 tr-text-metadata transition-colors focus-visible:focus-ring data-[on=true]:border-primary data-[on=true]:bg-primary-subtle data-[on=true]:text-primary";
const CHIP_OFF = "border-control-border-default text-text-muted hover:text-text-default";
const SCOPES: readonly PullRequestScope[] = ["review-requested", "mine", "all"];

function scopeLabel(t: Translator, scope: PullRequestScope): string {
	switch (scope) {
		case "review-requested":
			return t("chat.prCompletion.scopeWaiting");
		case "mine":
			return t("chat.prCompletion.scopeMine");
		case "all":
			return t("chat.prCompletion.scopeAll");
	}
}

function meta(t: Translator, pr: PullRequestSummary): string {
	if (!pr.size) return pr.author;
	const format = new Intl.NumberFormat(localeOf(t));
	const size = {
		additions: format.format(pr.size.additions),
		deletions: format.format(pr.size.deletions),
	};
	return pr.author
		? t("chat.prCompletion.meta", { author: pr.author, ...size })
		: t("chat.prCompletion.metaNoAuthor", size);
}

function StateTag({ pr }: { pr: PullRequestSummary }) {
	const t = useT();
	const label =
		pr.state === "merged"
			? t("chat.prCompletion.merged")
			: pr.state === "closed"
				? t("chat.prCompletion.closed")
				: pr.draft
					? t("chat.prCompletion.draft")
					: null;
	if (label === null) return null;
	return (
		<span
			data-testid="pull-request-tag"
			className="shrink-0 rounded-sm border border-border-muted px-4 text-text-muted tr-text-metadata"
		>
			{label}
		</span>
	);
}

function Row({
	pr,
	active,
	onPick,
	onHover,
}: {
	pr: PullRequestSummary;
	active: boolean;
	onPick: () => void;
	onHover: () => void;
}) {
	const t = useT();
	return (
		<button
			type="button"
			tabIndex={-1}
			data-testid="pull-request-option"
			data-pr={pr.number}
			data-active={active ? true : undefined}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onPick}
			onMouseEnter={onHover}
			className={cn(
				"flex w-full items-baseline gap-8 rounded-sm px-8 py-4 text-left tr-text-ui",
				active ? "bg-control-bg-selected text-text-default" : "text-text-default",
			)}
		>
			<span className="w-48 shrink-0 text-text-muted tr-text-metadata">
				{t("chat.prCompletion.number", { number: pr.number })}
			</span>
			<span className="min-w-0 flex-1 truncate">{pr.title}</span>
			<StateTag pr={pr} />
			<span className="shrink-0 text-text-muted tr-text-metadata">{meta(t, pr)}</span>
		</button>
	);
}

function Group({ heading, testId }: { heading: string; testId: string }) {
	return (
		<p data-testid={testId} className="px-8 pt-8 pb-2 text-text-muted tr-text-metadata">
			{heading}
		</p>
	);
}

function Filters({
	completion,
	firstChipRef,
	container,
	onLeave,
}: {
	completion: PullRequestCompletion;
	firstChipRef?: Ref<HTMLButtonElement> | undefined;
	container: HTMLElement | null;
	onLeave: () => void;
}) {
	const t = useT();
	const [authorsOpen, setAuthorsOpen] = useState(false);
	const { filter, setFilter } = completion;
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!event.currentTarget.contains(event.target as Node)) return;
		if (event.key === "Tab" || event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onLeave();
			return;
		}
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
		const chips = [
			...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-filter-chip]"),
		];
		const at = chips.indexOf(document.activeElement as HTMLButtonElement);
		const step = event.key === "ArrowRight" ? 1 : -1;
		chips[(at + step + chips.length) % chips.length]?.focus();
		event.preventDefault();
	};
	return (
		<div
			role="toolbar"
			aria-label={t("chat.prCompletion.filters")}
			data-testid="pull-request-filters"
			onKeyDown={onKeyDown}
			className="flex flex-wrap items-center gap-4 px-8 py-8"
		>
			<span className="mr-2 text-text-muted tr-text-metadata">{t("chat.prCompletion.show")}</span>
			{SCOPES.map((scope, index) => (
				<button
					key={scope}
					ref={index === 0 ? firstChipRef : undefined}
					type="button"
					data-filter-chip
					data-testid={`pull-request-scope-${scope}`}
					data-on={filter.scope === scope}
					aria-pressed={filter.scope === scope}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => setFilter({ ...filter, scope })}
					className={cn(CHIP, CHIP_OFF)}
				>
					{scopeLabel(t, scope)}
				</button>
			))}
			<span aria-hidden className="mx-2 h-16 w-px bg-border-muted" />
			<button
				type="button"
				data-filter-chip
				data-testid="pull-request-drafts"
				data-on={filter.drafts}
				aria-pressed={filter.drafts}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => setFilter({ ...filter, drafts: !filter.drafts })}
				className={cn(CHIP, CHIP_OFF)}
			>
				{t("chat.prCompletion.drafts")}
			</button>
			<Popover open={authorsOpen} onOpenChange={setAuthorsOpen}>
				<PopoverTrigger
					data-filter-chip
					data-testid="pull-request-author"
					data-on={filter.author !== undefined}
					className={cn(CHIP, CHIP_OFF, "flex items-center gap-2")}
				>
					{filter.author
						? t("chat.prCompletion.authorIs", { author: filter.author })
						: t("chat.prCompletion.author")}
					<ChevronDown className="size-12 shrink-0" />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					container={container}
					data-testid="pull-request-authors"
					onKeyDown={(event) => {
						if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
						const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
						const at = options.indexOf(document.activeElement as HTMLButtonElement);
						const step = event.key === "ArrowDown" ? 1 : -1;
						options[(at + step + options.length) % options.length]?.focus();
						event.preventDefault();
					}}
					className="max-h-[240px] w-[220px] overflow-y-auto p-4"
				>
					{[undefined, ...completion.authors].map((author) => (
						<button
							key={author ?? ""}
							type="button"
							data-testid="pull-request-author-option"
							data-author={author ?? ""}
							onClick={() => {
								const { author: _drop, ...rest } = filter;
								setFilter(author ? { ...rest, author } : rest);
								setAuthorsOpen(false);
								onLeave();
							}}
							className={cn(
								"flex w-full rounded-sm px-8 py-4 text-left tr-text-ui hover:bg-control-bg-hovered focus-visible:focus-ring-inset",
								filter.author === author ? "text-primary" : "text-text-default",
							)}
						>
							{author ?? t("chat.prCompletion.anyAuthor")}
						</button>
					))}
				</PopoverContent>
			</Popover>
		</div>
	);
}

function emptyText(t: Translator, scope: PullRequestScope): string {
	switch (scope) {
		case "review-requested":
			return t("chat.prCompletion.noneWaiting");
		case "mine":
			return t("chat.prCompletion.noneMine");
		case "all":
			return t("chat.prCompletion.none");
	}
}

function Body({
	completion,
	activeIndex,
	onPick,
	onHover,
}: {
	completion: PullRequestCompletion;
	activeIndex: number;
	onPick: (index: number) => void;
	onHover: (index: number) => void;
}) {
	const t = useT();
	const { listing, lookup, items, waitingCount, filter } = completion;
	if (listing.kind === "loading") {
		return (
			<p data-testid="pull-request-loading" className={NOTICE}>
				{t("chat.prCompletion.loading")}
			</p>
		);
	}
	if (listing.kind === "unavailable") {
		const { reason } = listing;
		return (
			<div
				data-testid="pull-request-unavailable"
				data-reason={reason}
				className="flex flex-col gap-8 px-8 py-8"
			>
				<p className="tr-text-ui text-text-default">
					{reason === "missing"
						? t("chat.prCompletion.ghMissing")
						: reason === "unauthenticated"
							? t("chat.prCompletion.ghSignedOut")
							: reason === "not-github"
								? t("chat.prCompletion.notGithub")
								: t("chat.prCompletion.failed")}
				</p>
				{reason === "missing" || reason === "unauthenticated" ? (
					<p className="text-text-muted tr-text-metadata">{t("chat.prCompletion.integrations")}</p>
				) : null}
				{reason === "failed" ? (
					<div>
						<Button
							variant="outline"
							size="s"
							data-testid="pull-request-retry"
							onMouseDown={(event) => event.preventDefault()}
							onClick={completion.retry}
						>
							{t("chat.prCompletion.retry")}
						</Button>
					</div>
				) : null}
			</div>
		);
	}
	if (lookup) {
		if (lookup.kind === "searching") {
			return (
				<p data-testid="pull-request-lookup-searching" className={NOTICE}>
					{t("chat.prCompletion.lookingUp", { number: lookup.number })}
				</p>
			);
		}
		if (lookup.kind === "missing") {
			return (
				<p data-testid="pull-request-lookup-missing" className={NOTICE}>
					{t("chat.prCompletion.notFound", { number: lookup.number })}
				</p>
			);
		}
	}
	if (items.length === 0) {
		return (
			<div data-testid="pull-request-empty" className="flex flex-col items-start gap-8 px-8 py-8">
				<p className="text-text-muted tr-text-ui">{emptyText(t, filter.scope)}</p>
				{filter.scope !== "all" ? (
					<Button
						variant="outline"
						size="s"
						data-testid="pull-request-show-all"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => completion.setFilter({ ...filter, scope: "all" })}
					>
						{t("chat.prCompletion.showAll")}
					</Button>
				) : null}
			</div>
		);
	}
	const row = (pr: PullRequestSummary, index: number) => (
		<Row
			key={pr.number}
			pr={pr}
			active={index === activeIndex}
			onPick={() => onPick(index)}
			onHover={() => onHover(index)}
		/>
	);
	const waiting = lookup ? [] : items.slice(0, waitingCount);
	const rest = lookup ? items : items.slice(waitingCount);
	return (
		<>
			{waiting.length > 0 ? (
				<>
					<Group heading={t("chat.prCompletion.waiting")} testId="pull-request-group-waiting" />
					{waiting.map((pr, index) => row(pr, index))}
				</>
			) : null}
			{rest.length > 0 ? (
				<>
					<Group
						heading={lookup ? t("chat.prCompletion.found") : t("chat.prCompletion.other")}
						testId={lookup ? "pull-request-group-found" : "pull-request-group-other"}
					/>
					{rest.map((pr, index) => row(pr, waiting.length + index))}
				</>
			) : null}
			{completion.hasMore ? (
				<button
					type="button"
					tabIndex={-1}
					data-testid="pull-request-more"
					data-active={activeIndex === items.length ? true : undefined}
					disabled={completion.loadingMore}
					onMouseDown={(event) => event.preventDefault()}
					onClick={completion.loadMore}
					className={cn(
						"flex w-full rounded-sm px-8 py-4 text-left text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default",
						activeIndex === items.length && "bg-control-bg-selected text-text-default",
					)}
				>
					{completion.loadingMore
						? t("chat.prCompletion.loadingMore")
						: t("chat.prCompletion.more")}
				</button>
			) : null}
		</>
	);
}

type PullRequestCompletionProps = {
	completion: PullRequestCompletion;
	activeIndex: number;
	onPick: (index: number) => void;
	onHover: (index: number) => void;
	firstChipRef?: Ref<HTMLButtonElement>;
	onLeaveFilters: () => void;
	notice?: string;
	container?: HTMLElement | null;
};

/** The completion's filters, rows and states, without its positioning. */
export function PullRequestCompletionContent({
	completion,
	activeIndex,
	onPick,
	onHover,
	firstChipRef,
	onLeaveFilters,
	notice,
	container = null,
}: PullRequestCompletionProps) {
	const t = useT();
	return (
		<ArgumentCompletionFrame
			header={
				<>
					{notice ? (
						<p
							data-testid="pull-request-notice"
							className="flex items-start gap-8 border-border-muted border-b px-8 py-8 text-text-muted tr-text-metadata"
						>
							<TriangleAlert className="mt-2 size-12 shrink-0 text-feedback-warning" aria-hidden />
							<span>{notice}</span>
						</p>
					) : null}
					<Filters
						completion={completion}
						firstChipRef={firstChipRef}
						container={container}
						onLeave={onLeaveFilters}
					/>
				</>
			}
			footer={
				<div className="flex flex-wrap items-center gap-12 px-8 py-4 text-text-muted tr-text-metadata">
					<span>{t("chat.prCompletion.keys")}</span>
					<span className="ml-auto">{t("chat.prCompletion.remembered")}</span>
				</div>
			}
		>
			<div data-testid="pull-request-completion">
				<Body completion={completion} activeIndex={activeIndex} onPick={onPick} onHover={onHover} />
			</div>
		</ArgumentCompletionFrame>
	);
}

/** The pull-request candidates of a `/<command> <argument>` prompt, opened above `anchor`. */
export function PullRequestCompletionMenu({
	anchor,
	className,
	...content
}: PullRequestCompletionProps & { anchor: RefObject<HTMLElement | null>; className?: string }) {
	return (
		<ArgumentCompletionMenu
			anchor={anchor}
			container={content.container ?? null}
			{...(className ? { className } : {})}
		>
			<PullRequestCompletionContent {...content} />
		</ArgumentCompletionMenu>
	);
}
