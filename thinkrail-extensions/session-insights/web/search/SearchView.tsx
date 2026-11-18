import {
	RiCloseLine,
	RiErrorWarningLine,
	RiPlayLine,
	RiRobot2Line,
	RiStopLine,
	RiTerminalBoxLine,
	RiUser3Line,
} from "@remixicon/react";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	FacetValues,
	ListProject,
	SearchFilterKey,
	SearchHit,
	SearchSnippet,
	SessionRef,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { sessionName } from "../copy";
import { formatClock, formatCount, formatStart } from "../format";
import {
	FACET_NONE,
	FACET_TITLE,
	type FacetKey,
	FIELD_COUNT,
	FIELD_LABEL,
	FILTER_LABEL,
	KIND_LABEL,
} from "./copy";
import { facetFilterValue, hasFilter, removeFilter, toggleFilter } from "./query";
import type { SearchControls, SearchGroupView, SearchState } from "./useSearch";

const FAILURE_TEXT = {
	disabled: "sessionInsights.error.disabled",
	updateHost: "sessionInsights.updateHost",
	failed: "sessionInsights.error.failed",
} as const;

const EXAMPLE = "tool:bash error:yes lint";

/** Text with the server's marks highlighted. */
function Marked({ snippet }: { snippet: SearchSnippet }) {
	const parts: ReactNode[] = [];
	let at = 0;
	for (const [from, to] of snippet.marks) {
		if (from > at) parts.push(snippet.text.slice(at, from));
		parts.push(
			<mark
				key={from}
				data-testid="insights-search-mark"
				className="rounded-xs bg-feedback-warning-muted text-text-default"
			>
				{snippet.text.slice(from, to)}
			</mark>,
		);
		at = to;
	}
	if (at < snippet.text.length) parts.push(snippet.text.slice(at));
	return (
		<>
			{snippet.head ? "…" : null}
			{parts}
			{snippet.tail ? "…" : null}
		</>
	);
}

function count(t: Translator, locale: string, value: number, exact: boolean): string {
	const formatted = formatCount(locale, value);
	return exact ? formatted : t("sessionInsights.search.atLeast", { value: formatted });
}

function Status({ state, controls }: { state: SearchState; controls: SearchControls }) {
	const t = useT();
	const locale = localeOf(t);
	const total = state.total;
	if (!total || state.phase === "idle" || state.phase === "loading") return null;
	const exact = total.exact;
	const summary = t("sessionInsights.search.summary", {
		events: t("sessionInsights.search.eventCount", {
			count: total.events,
			formatted: count(t, locale, total.events, exact),
		}),
		sessions: t("sessionInsights.search.sessionCount", {
			count: total.sessions,
			formatted: count(t, locale, total.sessions, exact),
		}),
	});
	const scanned = state.scanned;
	return (
		<span
			data-testid="insights-search-status"
			data-phase={state.phase}
			role="status"
			aria-live="polite"
			className="ml-auto flex shrink-0 items-center gap-8 tr-text-metadata text-text-muted tabular-nums"
		>
			<span data-testid="insights-search-count">
				{state.phase === "scanning"
					? t("sessionInsights.search.scanning", {
							summary,
							read: formatCount(locale, scanned?.sessions ?? 0),
							total: formatCount(locale, scanned?.total ?? 0),
						})
					: state.phase === "cancelled"
						? t("sessionInsights.search.cancelled", { summary })
						: summary}
			</span>
			{state.phase === "scanning" ? (
				<Button
					variant="outline"
					size="s"
					iconLeft={RiStopLine}
					data-testid="insights-search-stop"
					disabled={state.stopping}
					onClick={controls.stop}
				>
					{t("sessionInsights.search.stop")}
				</Button>
			) : state.phase === "cancelled" ? (
				<Button
					variant="outline"
					size="s"
					iconLeft={RiPlayLine}
					data-testid="insights-search-resume"
					onClick={controls.resume}
				>
					{t("sessionInsights.search.resume")}
				</Button>
			) : null}
		</span>
	);
}

function QueryBar({
	state,
	controls,
	text,
	onText,
}: {
	state: SearchState;
	controls: SearchControls;
	text: string;
	onText: (text: string) => void;
}) {
	const t = useT();
	const parsed = state.parsed;
	const typing = text.trimEnd().length;
	const ignored = parsed?.ignored.filter((span) => span.end < typing).length ?? 0;
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-4 border-border-default border-b px-12 py-4">
			{parsed?.filters.map((filter) => (
				<span
					key={`${filter.span.start}:${filter.key}`}
					data-testid="insights-search-chip"
					data-key={filter.key}
					data-value={filter.value}
					className={cn(
						"inline-flex min-w-0 max-w-320 items-center gap-2 rounded-sm border py-0 pl-4 tr-code-text-small",
						filter.key === "error"
							? "border-feedback-error-muted bg-feedback-error-subtle"
							: "border-border-default bg-control-bg",
					)}
				>
					<span className="shrink-0 text-primary">{`${filter.key}:`}</span>
					<span className="min-w-0 truncate text-text-default">{filter.value}</span>
					<IconButton
						icon={RiCloseLine}
						size="s"
						label={t("sessionInsights.search.removeFilter", {
							filter: `${filter.key}:${filter.value}`,
						})}
						onClick={() => onText(removeFilter(text, filter))}
					/>
				</span>
			))}
			{parsed?.terms.map((term) => (
				<span
					key={`${term.span.start}:term`}
					data-testid="insights-search-term"
					className="inline-flex min-w-0 max-w-320 items-center truncate rounded-sm bg-control-bg-hovered px-4 tr-code-text-small text-text-default"
				>
					{term.quoted ? `“${term.text}”` : term.text}
				</span>
			))}
			{parsed && parsed.unknown.length > 0 ? (
				<span
					data-testid="insights-search-unknown"
					className="tr-text-metadata text-feedback-warning"
				>
					{t("sessionInsights.search.unknown", {
						keys: parsed.unknown.map((item) => `${item.key}:`).join(", "),
					})}
				</span>
			) : null}
			{ignored > 0 ? (
				<span data-testid="insights-search-ignored" className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.search.ignored", { count: ignored })}
				</span>
			) : null}
			<Status state={state} controls={controls} />
		</div>
	);
}

function Hints({
	keys,
	onKey,
	onExample,
}: {
	keys: readonly SearchFilterKey[];
	onKey: (key: SearchFilterKey) => void;
	onExample: () => void;
}) {
	const t = useT();
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-4 px-12 py-4 tr-text-metadata text-text-subtle">
			<span>{t("sessionInsights.search.filters")}</span>
			{keys.map((key) => (
				<button
					key={key}
					type="button"
					data-testid="insights-search-hint"
					data-key={key}
					title={t(FILTER_LABEL[key])}
					onClick={() => onKey(key)}
					className="rounded-sm border border-border-default px-4 tr-code-text-small text-primary hover:bg-control-bg-hovered focus-visible:focus-ring"
				>
					{`${key}:`}
				</button>
			))}
			<span className="ml-auto">{t("sessionInsights.search.example")}</span>
			<button
				type="button"
				data-testid="insights-search-example"
				onClick={onExample}
				className="rounded-sm border border-border-default px-4 tr-code-text-small text-text-muted hover:bg-control-bg-hovered focus-visible:focus-ring"
			>
				{EXAMPLE}
			</button>
		</div>
	);
}

function FacetList({
	facet,
	title,
	none,
	filter,
	label,
	state,
	onToggle,
}: {
	facet: FacetValues;
	title: string;
	none: string;
	filter: SearchFilterKey;
	label?: ((value: string) => string) | undefined;
	state: SearchState;
	onToggle: (key: SearchFilterKey, value: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	if (facet.values.length === 0) return null;
	const exact = state.total?.exact ?? false;
	return (
		<fieldset
			data-testid="insights-search-facet"
			data-key={filter}
			className="flex min-w-0 flex-col gap-2"
		>
			<legend className="pb-2 tr-text-eyebrow text-text-subtle">{title}</legend>
			{facet.values.map((item) => {
				const checked = hasFilter(state.parsed, filter, item.value) !== null;
				return (
					<label
						key={item.value}
						data-testid="insights-search-facet-value"
						data-value={item.value}
						className="flex min-w-0 cursor-pointer items-center gap-8 rounded-sm px-4 py-2 tr-text-metadata text-text-muted hover:bg-control-bg-hovered has-[:focus-visible]:focus-ring"
					>
						<input
							type="checkbox"
							checked={checked}
							onChange={() => onToggle(filter, facetFilterValue(item.value))}
							className="size-12 shrink-0 accent-primary"
						/>
						<span
							className={cn(
								"min-w-0 flex-1 truncate",
								item.value === "" ? "italic" : "text-text-default",
								filter === "tool" && item.value !== "" ? "tr-code-text-small" : null,
							)}
							title={item.value || none}
						>
							{item.value === "" ? none : (label?.(item.value) ?? item.value)}
						</span>
						<span data-testid="insights-search-facet-count" className="shrink-0 tabular-nums">
							{count(t, locale, item.count, exact)}
						</span>
					</label>
				);
			})}
			{facet.others > 0 ? (
				<span className="px-4 tr-text-metadata text-text-subtle">
					{t("sessionInsights.search.facetOthers", {
						formatted: formatCount(locale, facet.others),
					})}
				</span>
			) : null}
		</fieldset>
	);
}

function Facets({
	state,
	scopeAll,
	onToggle,
}: {
	state: SearchState;
	scopeAll: boolean;
	onToggle: (key: SearchFilterKey, value: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const facets = state.facets;
	if (!facets || (state.total?.events ?? 0) === 0) return null;
	const exact = state.total?.exact ?? false;
	const facetOf = (key: FacetKey) => (
		<FacetList
			key={key}
			facet={facets[key]}
			title={t(FACET_TITLE[key])}
			none={t(FACET_NONE[key])}
			filter={key}
			label={key === "model" ? (value) => value.split("/").pop() ?? value : undefined}
			state={state}
			onToggle={onToggle}
		/>
	);
	const errors: readonly ["yes" | "no", number][] = [
		["yes", facets.error.yes],
		["no", facets.error.no],
	];
	return (
		<aside
			data-testid="insights-search-facets"
			aria-label={t("sessionInsights.search.facets")}
			className="flex w-200 shrink-0 flex-col gap-12 overflow-y-auto border-border-default border-r p-12"
		>
			{facetOf("tool")}
			{facetOf("model")}
			{facetOf("skill")}
			{scopeAll ? facetOf("project") : null}
			<fieldset
				data-testid="insights-search-facet"
				data-key="error"
				className="flex flex-col gap-2"
			>
				<legend className="pb-2 tr-text-eyebrow text-text-subtle">
					{t("sessionInsights.search.facet.error")}
				</legend>
				{errors.map(([value, n]) => (
					<label
						key={value}
						data-testid="insights-search-facet-value"
						data-value={value}
						className="flex min-w-0 cursor-pointer items-center gap-8 rounded-sm px-4 py-2 tr-text-metadata text-text-muted hover:bg-control-bg-hovered has-[:focus-visible]:focus-ring"
					>
						<input
							type="checkbox"
							checked={hasFilter(state.parsed, "error", value) !== null}
							onChange={() => onToggle("error", value)}
							className="size-12 shrink-0 accent-primary"
						/>
						<span className="min-w-0 flex-1 truncate text-text-default">
							{t(
								value === "yes"
									? "sessionInsights.search.withError"
									: "sessionInsights.search.noError",
							)}
						</span>
						<span data-testid="insights-search-facet-count" className="shrink-0 tabular-nums">
							{count(t, locale, n, exact)}
						</span>
					</label>
				))}
			</fieldset>
			<p className="tr-text-metadata text-text-subtle">
				{t("sessionInsights.search.skillHeuristic")}
			</p>
		</aside>
	);
}

function KindIcon({ hit }: { hit: SearchHit }) {
	const Icon =
		hit.kind === "turn" ? RiUser3Line : hit.kind === "llm" ? RiRobot2Line : RiTerminalBoxLine;
	return (
		<Icon
			aria-hidden
			className={cn("size-14 shrink-0", hit.error ? "text-feedback-error" : "text-text-subtle")}
		/>
	);
}

/** Where a key moves the focus from row `at` of `count`: another row, back to the search field, or nowhere. */
export function rowTarget(key: string, at: number, count: number): number | "input" | null {
	switch (key) {
		case "ArrowDown":
			return Math.min(count - 1, at + 1);
		case "ArrowUp":
			return at <= 0 ? "input" : at - 1;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		case "Escape":
			return "input";
		default:
			return null;
	}
}

function moveFocus(event: KeyboardEvent<HTMLButtonElement>, onToInput: () => void): void {
	if (isImeComposing(event.nativeEvent)) return;
	const rows = Array.from(
		event.currentTarget
			.closest("[data-search-results]")
			?.querySelectorAll<HTMLButtonElement>("[data-search-row]") ?? [],
	);
	const target = rowTarget(event.key, rows.indexOf(event.currentTarget), rows.length);
	if (target === null) return;
	event.preventDefault();
	if (target === "input") onToInput();
	else rows[target]?.focus();
}

function HitRow({
	hit,
	session,
	onOpen,
	onToInput,
}: {
	hit: SearchHit;
	session: SessionRef;
	onOpen: (session: SessionRef, eventId: string) => void;
	onToInput: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const snippet = hit.snippet;
	const inline =
		snippet &&
		(snippet.field === "args" || snippet.field === "prompt" || snippet.field === "reply");
	const below = snippet && !inline ? snippet : null;
	const kind = hit.kind === "tool" ? (hit.tool ?? t(KIND_LABEL.tool)) : t(KIND_LABEL[hit.kind]);
	const others = hit.fields.filter((item) => item.field !== snippet?.field);
	return (
		<li>
			<button
				type="button"
				data-search-row
				data-testid="insights-search-hit"
				data-event-id={hit.eventId}
				data-kind={hit.kind}
				data-error={hit.error}
				onClick={() => onOpen(session, hit.eventId)}
				onKeyDown={(event) => moveFocus(event, onToInput)}
				title={t("sessionInsights.search.open")}
				className="grid w-full min-w-0 grid-cols-[4.5rem_2.25rem_0.875rem_5.5rem_minmax(0,1fr)_auto] items-center gap-x-8 gap-y-2 rounded-sm px-8 py-4 text-left tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring-inset"
			>
				<span className="truncate text-text-subtle tabular-nums">
					{formatClock(locale, hit.t, false)}
				</span>
				<span className="truncate text-text-subtle tabular-nums">
					{hit.turn > 0 ? t("sessionInsights.search.turn", { n: hit.turn }) : null}
				</span>
				<KindIcon hit={hit} />
				<span
					data-testid="insights-search-hit-kind"
					className={cn(
						"truncate",
						hit.kind === "tool" ? "tr-code-text-small text-text-default" : "text-text-muted",
					)}
				>
					{kind}
				</span>
				<span
					data-testid="insights-search-hit-text"
					className={cn(
						"min-w-0 truncate text-text-default",
						hit.kind === "tool" ? "tr-code-text-small" : null,
					)}
				>
					{inline && snippet ? <Marked snippet={snippet} /> : hit.label}
				</span>
				<span className="flex min-w-0 items-center justify-end gap-4">
					{others.map((item) => (
						<span
							key={item.field}
							data-testid="insights-search-hit-also"
							data-field={item.field}
							className="shrink-0 rounded-sm border border-border-default px-4 tr-text-metadata text-text-subtle"
						>
							{t(FIELD_COUNT[item.field], { n: formatCount(locale, item.count) })}
						</span>
					))}
					{hit.model ? (
						<span
							title={hit.model}
							className="max-w-120 shrink-0 truncate rounded-sm border border-border-default px-4 tr-text-metadata text-text-muted"
						>
							{hit.model.split("/").pop()}
						</span>
					) : null}
				</span>
				{below ? (
					<span
						data-testid="insights-search-hit-snippet"
						data-field={below.field}
						className={cn(
							"col-span-2 col-start-5 flex min-w-0 items-baseline gap-8 tr-code-text-small",
							below.field === "error" ? "text-feedback-error" : "text-text-muted",
						)}
					>
						<span className="shrink-0 tr-text-metadata text-text-subtle">
							{t(FIELD_LABEL[below.field])}
						</span>
						<span className="min-w-0 truncate">
							<Marked snippet={below} />
						</span>
					</span>
				) : hit.error && hit.errorLine ? (
					<span
						data-testid="insights-search-hit-error"
						className="col-span-2 col-start-5 flex min-w-0 items-center gap-4 tr-code-text-small text-feedback-error"
					>
						<RiErrorWarningLine aria-hidden className="size-12 shrink-0" />
						<span className="min-w-0 truncate">{hit.errorLine}</span>
					</span>
				) : null}
			</button>
		</li>
	);
}

function Group({
	group,
	projects,
	scopeAll,
	now,
	busy,
	loadingMore,
	onOpen,
	onMore,
	onToInput,
}: {
	group: SearchGroupView;
	projects: readonly ListProject[];
	scopeAll: boolean;
	now: number;
	busy: boolean;
	loadingMore: boolean;
	onOpen: (session: SessionRef, eventId: string) => void;
	onMore: () => void;
	onToInput: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { session } = group;
	const project = scopeAll
		? (projects.find((candidate) => candidate.id === session.projectId)?.name ?? null)
		: null;
	return (
		<li
			data-testid="insights-search-group"
			data-session-id={session.sessionId}
			className="flex min-w-0 flex-col border-border-muted border-b pb-4"
		>
			<div className="flex min-w-0 items-baseline gap-8 px-8 pt-8 pb-2">
				<span
					className="min-w-0 truncate tr-text-ui text-text-default"
					title={sessionName(t, session)}
				>
					{sessionName(t, session)}
				</span>
				{project ? (
					<span className="shrink-0 tr-text-metadata text-text-subtle">{project}</span>
				) : null}
				{session.start !== null ? (
					<span className="shrink-0 tr-text-metadata text-text-subtle tabular-nums">
						{formatStart(locale, session.start, now)}
					</span>
				) : null}
				<span
					data-testid="insights-search-group-matches"
					className="ml-auto shrink-0 tr-text-metadata text-text-muted tabular-nums"
				>
					{t("sessionInsights.search.matches", {
						count: group.matches,
						formatted: formatCount(locale, group.matches),
					})}
				</span>
			</div>
			<ul className="flex min-w-0 flex-col">
				{group.events.map((hit) => (
					<HitRow
						key={hit.eventId}
						hit={hit}
						session={session}
						onOpen={onOpen}
						onToInput={onToInput}
					/>
				))}
			</ul>
			{group.more ? (
				<Button
					variant="ghost"
					size="s"
					className="self-start"
					data-testid="insights-search-group-more"
					disabled={busy}
					loading={loadingMore}
					onClick={onMore}
				>
					{t("sessionInsights.search.moreInSession", {
						count: group.matches - group.shown,
						formatted: formatCount(locale, group.matches - group.shown),
					})}
				</Button>
			) : null}
		</li>
	);
}

function Body({
	state,
	controls,
	scopeAll,
	now,
	onOpen,
	onToInput,
	resultsRef,
}: {
	state: SearchState;
	controls: SearchControls;
	scopeAll: boolean;
	now: number;
	onOpen: (session: SessionRef, eventId: string) => void;
	onToInput: () => void;
	resultsRef: RefObject<HTMLDivElement | null>;
}) {
	const t = useT();
	switch (state.phase) {
		case "version":
			return (
				<p
					data-testid="session-insights-update-host"
					className="p-16 text-center tr-text-ui text-text-muted"
				>
					{t("sessionInsights.updateHost")}
				</p>
			);
		case "error":
			return (
				<div
					data-testid="insights-search-error"
					role="alert"
					className="flex flex-col items-center gap-8 p-16 text-center tr-text-ui text-text-muted"
				>
					<span>{t(FAILURE_TEXT[state.failure ?? "failed"])}</span>
					{state.failure === "failed" || state.failure === null ? (
						<Button variant="outline" size="m" onClick={controls.retry}>
							{t("common.retry")}
						</Button>
					) : null}
				</div>
			);
		case "idle":
			return (
				<div
					data-testid="insights-search-idle"
					className="flex flex-col gap-8 p-16 tr-text-ui text-text-muted"
				>
					<p>{t("sessionInsights.search.idle")}</p>
					<p className="tr-text-metadata text-text-subtle">{t("sessionInsights.search.idleHow")}</p>
				</div>
			);
		case "loading":
			return (
				<LoadingRegion
					rows={6}
					label={t("sessionInsights.search.searching")}
					testId="insights-search-loading"
					className="p-16"
				/>
			);
		default:
			break;
	}
	if (state.groups.length === 0) {
		if (state.phase === "scanning")
			return (
				<LoadingRegion
					rows={6}
					label={t("sessionInsights.search.searching")}
					testId="insights-search-loading"
					className="p-16"
				/>
			);
		return (
			<div
				data-testid="insights-search-empty"
				className="flex flex-col items-center gap-4 p-16 text-center tr-text-ui text-text-muted"
			>
				<span>{t("sessionInsights.search.empty")}</span>
				{(state.parsed?.filters.length ?? 0) > 0 ? (
					<span className="tr-text-metadata text-text-subtle">
						{t("sessionInsights.search.emptyHint")}
					</span>
				) : null}
			</div>
		);
	}
	const busy = state.pending !== null;
	return (
		<div
			ref={resultsRef}
			data-search-results
			data-testid="insights-search-results"
			className="flex min-w-0 flex-col"
		>
			<ul aria-label={t("sessionInsights.search.results")} className="flex min-w-0 flex-col">
				{state.groups.map((group) => (
					<Group
						key={group.session.sessionId}
						group={group}
						projects={state.projects}
						scopeAll={scopeAll}
						now={now}
						busy={busy}
						loadingMore={state.loadingMore.includes(group.session.sessionId)}
						onOpen={onOpen}
						onMore={() => controls.showMore(group.session.sessionId)}
						onToInput={onToInput}
					/>
				))}
			</ul>
			<div className="flex items-center gap-8 px-8 py-8 tr-text-metadata text-text-subtle">
				{state.phase === "more" ? (
					<Button
						variant="outline"
						size="s"
						data-testid="insights-search-load-more"
						disabled={busy}
						onClick={controls.loadMore}
					>
						{t("sessionInsights.search.loadMore")}
					</Button>
				) : state.phase === "done" ? (
					<span data-testid="insights-search-end">{t("sessionInsights.search.end")}</span>
				) : null}
				<span className="ml-auto">{t("sessionInsights.search.order")}</span>
			</div>
		</div>
	);
}

/** Search across the scope's sessions: the parsed query, facet counts and events grouped by session. */
export function SearchView({
	controls,
	text,
	onText,
	keys,
	scopeAll,
	now,
	onOpen,
	onToInput,
	onFilterKey,
	resultsRef,
}: {
	controls: SearchControls;
	text: string;
	onText: (text: string) => void;
	keys: readonly SearchFilterKey[];
	scopeAll: boolean;
	now: number;
	onOpen: (session: SessionRef, eventId: string) => void;
	onToInput: () => void;
	/** A filter hint was picked: append `key:` and type its value. */
	onFilterKey: (key: SearchFilterKey) => void;
	resultsRef: RefObject<HTMLDivElement | null>;
}) {
	const { state } = controls;
	return (
		<div data-testid="insights-search-view" className="flex min-h-0 flex-1 flex-col">
			<QueryBar state={state} controls={controls} text={text} onText={onText} />
			<Hints keys={keys} onKey={onFilterKey} onExample={() => onText(EXAMPLE)} />
			<div className="flex min-h-0 flex-1">
				<Facets
					state={state}
					scopeAll={scopeAll}
					onToggle={(key, value) => onText(toggleFilter(text, state.parsed, key, value))}
				/>
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
					<Body
						state={state}
						controls={controls}
						scopeAll={scopeAll}
						now={now}
						onOpen={onOpen}
						onToInput={onToInput}
						resultsRef={resultsRef}
					/>
				</div>
			</div>
		</div>
	);
}
