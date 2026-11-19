import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiGitPullRequestLine as PullRequestIcon,
} from "@remixicon/react";
import type { PullRequestSummary } from "@thinkrail/contracts";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import type { Ref } from "react";
import { useState } from "react";
import {
	type PickedPullRequest,
	type PullRequestListState,
	type PullRequestLookup,
	pullRequestRows,
	usePullRequestLookup,
} from "./pullRequests";

const NOTICE = "px-12 py-12 text-text-muted tr-text-ui";

function pullRequestSize(t: Translator, pr: PullRequestSummary): string {
	const format = new Intl.NumberFormat(localeOf(t));
	const size = { additions: format.format(pr.additions), deletions: format.format(pr.deletions) };
	return pr.author
		? t("panels.prPicker.meta", { author: pr.author, ...size })
		: t("panels.prPicker.metaNoAuthor", size);
}

function StateTag({ pr }: { pr: PullRequestSummary }) {
	const t = useT();
	const label =
		pr.state === "merged"
			? t("panels.prPicker.merged")
			: pr.state === "closed"
				? t("panels.prPicker.closed")
				: pr.draft
					? t("panels.prPicker.draft")
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

function PullRequestRow({
	pr,
	selected,
	onSelect,
}: {
	pr: PullRequestSummary;
	selected: boolean;
	onSelect: (pr: PullRequestSummary) => void;
}) {
	const t = useT();
	return (
		<CommandItem
			value={`pr-${pr.number}`}
			data-testid="pull-request-option"
			data-pr={pr.number}
			data-active={selected ? true : undefined}
			onSelect={() => onSelect(pr)}
			className="gap-8"
		>
			<span className="flex w-14 shrink-0 justify-center">
				{selected ? <Check className="size-14 text-primary" /> : null}
			</span>
			<span className="shrink-0 text-text-muted tr-text-metadata">
				{t("panels.prPicker.number", { number: pr.number })}
			</span>
			<span className="min-w-0 flex-1 truncate">{pr.title}</span>
			<StateTag pr={pr} />
			<span className="shrink-0 text-text-muted tr-text-metadata">{pullRequestSize(t, pr)}</span>
		</CommandItem>
	);
}

function LookupRows({
	lookup,
	selected,
	onSelect,
}: {
	lookup: PullRequestLookup;
	selected: number | null;
	onSelect: (pr: PullRequestSummary) => void;
}) {
	const t = useT();
	switch (lookup.kind) {
		case "idle":
			return null;
		case "searching":
			return (
				<p data-testid="pull-request-lookup-searching" className={NOTICE}>
					{t("panels.prPicker.lookingUp", { number: lookup.number })}
				</p>
			);
		case "missing":
			return (
				<p data-testid="pull-request-lookup-missing" className={NOTICE}>
					{t("panels.prPicker.notFound", { number: lookup.number })}
				</p>
			);
		case "found":
			return (
				<CommandGroup heading={t("panels.prPicker.found")}>
					<PullRequestRow
						pr={lookup.pullRequest}
						selected={lookup.pullRequest.number === selected}
						onSelect={onSelect}
					/>
				</CommandGroup>
			);
	}
}

/** The popover's body: the list in its state, grouped and filtered by the query. */
export function PullRequestPickerBody({
	list,
	query,
	lookup,
	selected,
	onQueryChange,
	onSelect,
	onRetry,
}: {
	list: PullRequestListState;
	query: string;
	lookup: PullRequestLookup;
	selected: number | null;
	onQueryChange: (query: string) => void;
	onSelect: (pr: PullRequestSummary) => void;
	onRetry: () => void;
}) {
	const t = useT();
	if (list.kind === "loading") {
		return (
			<p data-testid="pull-request-picker-loading" className={NOTICE}>
				{t("panels.prPicker.loading")}
			</p>
		);
	}
	if (list.kind === "unavailable") {
		const reason = list.reason;
		return (
			<div
				data-testid="pull-request-picker-unavailable"
				data-reason={reason}
				className="flex flex-col gap-8 px-12 py-12"
			>
				<p className="tr-text-ui text-text-default">
					{reason === "missing"
						? t("panels.prPicker.ghMissing")
						: reason === "unauthenticated"
							? t("panels.prPicker.ghSignedOut")
							: reason === "not-github"
								? t("panels.prPicker.notGithub")
								: t("panels.prPicker.failed")}
				</p>
				{reason === "missing" || reason === "unauthenticated" ? (
					<p className="text-text-muted tr-text-metadata">{t("panels.prPicker.integrations")}</p>
				) : null}
				{reason === "failed" ? (
					<div>
						<Button
							variant="outline"
							size="m"
							data-testid="pull-request-picker-retry"
							onClick={onRetry}
						>
							{t("panels.prPicker.retry")}
						</Button>
					</div>
				) : null}
			</div>
		);
	}
	const rows = pullRequestRows(list.pullRequests, query);
	const nothing = rows.waiting.length === 0 && rows.open.length === 0 && lookup.kind === "idle";
	return (
		<>
			<CommandInput
				value={query}
				onValueChange={onQueryChange}
				data-testid="pull-request-picker-search"
				placeholder={t("panels.prPicker.search")}
			/>
			<CommandList>
				{rows.waiting.length > 0 ? (
					<CommandGroup
						heading={t("panels.prPicker.waiting")}
						data-testid="pull-request-group-waiting"
					>
						{rows.waiting.map((pr) => (
							<PullRequestRow
								key={pr.number}
								pr={pr}
								selected={pr.number === selected}
								onSelect={onSelect}
							/>
						))}
					</CommandGroup>
				) : null}
				{rows.open.length > 0 ? (
					<CommandGroup heading={t("panels.prPicker.open")} data-testid="pull-request-group-open">
						{rows.open.map((pr) => (
							<PullRequestRow
								key={pr.number}
								pr={pr}
								selected={pr.number === selected}
								onSelect={onSelect}
							/>
						))}
					</CommandGroup>
				) : null}
				{rows.lookup !== null ? (
					<LookupRows lookup={lookup} selected={selected} onSelect={onSelect} />
				) : null}
				{nothing ? (
					<p data-testid="pull-request-picker-empty" className={NOTICE}>
						{list.pullRequests.length === 0 && !query.trim()
							? t("panels.prPicker.none")
							: t("panels.prPicker.noMatch")}
					</p>
				) : null}
			</CommandList>
		</>
	);
}

export function PullRequestPicker({
	projectId,
	list,
	selected,
	open,
	testid,
	triggerClassName,
	triggerRef,
	container = null,
	onOpenChange,
	onSelect,
	onRetry,
	onSubmit,
}: {
	projectId: string;
	list: PullRequestListState;
	selected: PickedPullRequest | null;
	open: boolean;
	testid: string;
	triggerClassName: string;
	triggerRef?: Ref<HTMLButtonElement>;
	container?: HTMLElement | null;
	onOpenChange: (open: boolean) => void;
	onSelect: (pr: PullRequestSummary) => void;
	onRetry: () => void;
	/** Enter on the closed trigger once a pull request is picked. */
	onSubmit: () => void;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const reference =
		open && list.kind === "ready" ? pullRequestRows(list.pullRequests, query).lookup : null;
	const lookup = usePullRequestLookup(projectId, reference);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (!next) setQuery("");
				onOpenChange(next);
			}}
		>
			<PopoverTrigger
				ref={triggerRef}
				data-testid={testid}
				data-open={open}
				data-pr={selected?.number}
				className={triggerClassName}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || open || !selected || event.repeat) return;
					event.preventDefault();
					onSubmit();
				}}
			>
				<PullRequestIcon className="size-14 shrink-0 text-text-muted" />
				<span className="shrink-0 text-text-muted tr-text-metadata">
					{t("panels.prPicker.label")}
				</span>
				<span className="truncate tr-text-metadata">
					{selected
						? selected.title
							? t("panels.prPicker.picked", { number: selected.number, title: selected.title })
							: t("panels.prPicker.number", { number: selected.number })
						: t("panels.prPicker.placeholder")}
				</span>
				<ChevronDown className="size-16 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				container={container}
				data-testid="pull-request-picker"
				className="w-[520px] max-w-[calc(100vw-48px)] p-0"
			>
				<Command shouldFilter={false}>
					<PullRequestPickerBody
						list={list}
						query={query}
						lookup={lookup}
						selected={selected?.number ?? null}
						onQueryChange={setQuery}
						onSelect={(pr) => {
							onSelect(pr);
							setQuery("");
							onOpenChange(false);
						}}
						onRetry={onRetry}
					/>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
