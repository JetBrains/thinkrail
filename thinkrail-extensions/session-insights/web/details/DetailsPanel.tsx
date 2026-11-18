import {
	RiArrowRightSLine,
	RiChat3Line,
	RiFileCopyLine,
	RiFocus3Line,
	RiListUnordered,
	RiLockLine,
} from "@remixicon/react";
import type { PanelChatTarget, PanelHost } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	CallUsage,
	EventBody,
	SessionOverview,
	TimingOrigin,
	TraceEvent,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { formatCostExact, formatCount, formatDateTime, formatSpan, formatTokens } from "../format";
import { loadAnchor, loadEvent } from "../session/api";
import { Tabs, tabPanel } from "../Tabs";
import { eventRef } from "../trace/children";
import type { TraceModel } from "../trace/model";
import { eventIcon, eventSubtitle, eventTitle, eventTone, MARK_TITLE } from "../trace/TraceTree";
import { useKeyedQuery } from "../useKeyedQuery";
import { CappedTextView } from "./CappedTextView";
import { JsonViewer } from "./JsonViewer";
import { SubagentTab } from "./SubagentTab";
import { type DetailTab, initialTab, RENDERED_TOOLS, TAB_LABEL, tabsFor } from "./tabs";

const NEXT_COUNT = 3;
const USAGE_SOURCE = "message[assistant].usage";

const TIMING_NOTE = {
	recorded: "sessionInsights.details.timing.recorded",
	approximated: "sessionInsights.details.timing.approximated",
	notMeasured: "sessionInsights.details.timing.notMeasured",
} as const satisfies Record<TimingOrigin, MessageKey>;

function useEventBody(host: PanelHost, sessionId: string, eventId: string | null, attempt: number) {
	return useKeyedQuery(eventId === null ? null : `${eventId}:${attempt}`, (signal) => {
		const ref = eventRef(eventId ?? "");
		return loadEvent(host, sessionId, ref.eventId, signal, ref.childId);
	});
}

export function chatTargetOf(overview: SessionOverview | null): PanelChatTarget | null {
	if (overview?.workspaceState !== "open" || !overview.projectId || !overview.workspaceId)
		return null;
	return {
		projectId: overview.projectId,
		workspaceId: overview.workspaceId,
		sessionId: overview.sessionId,
	};
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-text-subtle">{label}</dt>
			<dd className="min-w-0 truncate text-text-default tabular-nums">{children}</dd>
		</>
	);
}

function Facts({ children }: { children: ReactNode }) {
	return (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-12 gap-y-2 tr-text-metadata">
			{children}
		</dl>
	);
}

function TimingValue({ event }: { event: TraceEvent }) {
	const t = useT();
	const locale = localeOf(t);
	const text =
		event.timing === "notMeasured"
			? t("sessionInsights.details.timing.none")
			: `${event.timing === "approximated" ? "≈ " : ""}${formatSpan(t, locale, event.t1 - event.t0)}`;
	return (
		<IconTooltip label={t(TIMING_NOTE[event.timing])} align="start">
			<button
				type="button"
				data-testid="details-duration"
				className="rounded-sm text-left focus-visible:focus-ring"
			>
				{text}
			</button>
		</IconTooltip>
	);
}

function UsageTable({ usage }: { usage: CallUsage }) {
	const t = useT();
	const locale = localeOf(t);
	const rows: [MessageKey, number][] = [
		["sessionInsights.details.usage.input", usage.input],
		["sessionInsights.details.usage.cacheRead", usage.cacheRead],
		["sessionInsights.details.usage.cacheWrite", usage.cacheWrite],
		["sessionInsights.details.usage.context", usage.context],
		["sessionInsights.details.usage.output", usage.output],
	];
	return (
		<section aria-label={t("sessionInsights.details.usage.title")} className="flex flex-col gap-4">
			<div className="flex items-baseline gap-8">
				<span className="tr-text-eyebrow text-text-muted">
					{t("sessionInsights.details.usage.title")}
				</span>
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.details.usage.origin")}{" "}
					<code className="tr-code-text-small">{USAGE_SOURCE}</code>
				</span>
			</div>
			<Facts>
				{rows.map(([label, value]) => (
					<Fact key={label} label={t(label)}>
						{formatCount(locale, value)}
					</Fact>
				))}
				{usage.reasoning !== null ? (
					<Fact label={t("sessionInsights.details.usage.reasoning")}>
						{formatCount(locale, usage.reasoning)}
					</Fact>
				) : null}
				<Fact label={t("sessionInsights.details.usage.cost")}>
					{usage.cost === 0
						? t("sessionInsights.details.usage.costNotRecorded")
						: formatCostExact(locale, usage.cost)}
				</Fact>
			</Facts>
		</section>
	);
}

function Thinking({ body, query }: { body: EventBody; query: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			{body.thinking ? (
				<>
					<Button
						variant="ghost"
						size="s"
						aria-expanded={open}
						iconLeft={RiArrowRightSLine}
						onClick={() => setOpen(!open)}
					>
						{t(
							open
								? "sessionInsights.details.thinking.hide"
								: "sessionInsights.details.thinking.show",
						)}
					</Button>
					{open ? (
						<CappedTextView
							value={body.thinking}
							label={t("sessionInsights.details.thinking.title")}
							query={query}
							prose
						/>
					) : null}
				</>
			) : null}
			{body.encryptedThinking ? (
				<p
					data-testid="details-encrypted"
					className="flex items-center gap-4 tr-text-metadata text-text-subtle"
				>
					<RiLockLine aria-hidden className="size-12 shrink-0" />
					{t("sessionInsights.details.thinking.encrypted", { count: body.encryptedThinking })}
				</p>
			) : null}
		</div>
	);
}

function ReplyTab({
	body,
	query,
	model,
	onSelect,
}: {
	body: EventBody;
	query: string;
	model: TraceModel;
	onSelect: (index: number) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<div className="flex flex-col gap-12">
			<Facts>
				<Fact label={t("sessionInsights.details.model")}>{body.model ?? "—"}</Fact>
				<Fact label={t("sessionInsights.details.stop")}>{body.stop ?? "—"}</Fact>
				{body.requestedAt ? (
					<Fact label={t("sessionInsights.details.requestedAt")}>
						{formatDateTime(locale, body.requestedAt)}
					</Fact>
				) : null}
			</Facts>
			{body.error ? (
				<CappedTextView
					value={body.error}
					label={t("sessionInsights.details.error")}
					query={query}
					tone="error"
					testId="details-error"
				/>
			) : null}
			{body.reply ? (
				<CappedTextView
					value={body.reply}
					label={t("sessionInsights.details.reply")}
					query={query}
					prose
					testId="details-reply"
				/>
			) : (
				<p className="tr-text-metadata text-text-subtle">{t("sessionInsights.details.noReply")}</p>
			)}
			<Thinking body={body} query={query} />
			{body.usage ? <UsageTable usage={body.usage} /> : null}
			{body.issued && body.issued.length > 0 ? (
				<section aria-label={t("sessionInsights.details.issued")} className="flex flex-col gap-4">
					<span className="tr-text-eyebrow text-text-muted">
						{t("sessionInsights.details.issued")}
					</span>
					<EventLinks
						indices={body.issued.map((call) => model.indexOf(call.eventId)).filter((at) => at >= 0)}
						model={model}
						onSelect={onSelect}
					/>
				</section>
			) : null}
		</div>
	);
}

function toolResult(body: EventBody) {
	return {
		content: body.result ? [{ type: "text", text: body.result.text }] : [],
		details: body.details?.value,
	};
}

function InputTab({
	host,
	event,
	body,
	query,
}: {
	host: PanelHost;
	event: TraceEvent;
	body: EventBody;
	query: string;
}) {
	const t = useT();
	const tool = body.tool ?? (event.kind === "tool" ? event.tool : "");
	const renderable = RENDERED_TOOLS.has(tool) && body.input !== undefined && event.kind === "tool";
	const [view, setView] = useState<"rendered" | "json">(renderable ? "rendered" : "json");
	const shown = renderable ? view : "json";
	const args =
		body.input &&
		typeof body.input.value === "object" &&
		body.input.value !== null &&
		!Array.isArray(body.input.value)
			? body.input.value
			: {};
	return (
		<div className="flex flex-col gap-8">
			{renderable ? (
				<fieldset
					aria-label={t("sessionInsights.details.view")}
					className="flex min-w-0 items-center gap-4"
				>
					<ToggleSegment
						testid="details-view-rendered"
						label={t("sessionInsights.details.rendered")}
						active={shown === "rendered"}
						onClick={() => setView("rendered")}
					/>
					<ToggleSegment
						testid="details-view-json"
						label={t("sessionInsights.details.json")}
						active={shown === "json"}
						onClick={() => setView("json")}
					/>
				</fieldset>
			) : null}
			{shown === "rendered" ? (
				<div data-testid="details-rendered" className="min-w-0 overflow-auto">
					{host.renderToolCall({
						toolCallId: body.toolCallId ?? event.id,
						toolName: tool,
						args: { ...args },
						result: toolResult(body),
						status: event.error ? "error" : "done",
					})}
				</div>
			) : body.input ? (
				<JsonViewer
					value={body.input.value}
					cuts={body.input.cuts}
					label={t("sessionInsights.details.arguments")}
					query={query}
					testId="details-input"
				/>
			) : (
				<p className="tr-text-metadata text-text-subtle">{t("sessionInsights.details.noInput")}</p>
			)}
			{body.task && event.kind === "subagent" ? (
				<CappedTextView
					value={body.task}
					label={t("sessionInsights.details.task")}
					query={query}
					prose
				/>
			) : null}
		</div>
	);
}

function ResultTab({ event, body, query }: { event: TraceEvent; body: EventBody; query: string }) {
	const t = useT();
	const locale = localeOf(t);
	if (event.kind === "tool" && event.missing)
		return (
			<p className="tr-text-metadata text-feedback-error">
				{t("sessionInsights.details.missingResult")}
			</p>
		);
	return (
		<div className="flex flex-col gap-8">
			{body.result ? (
				<CappedTextView
					value={body.result}
					label={t(
						event.error ? "sessionInsights.details.errorOutput" : "sessionInsights.details.output",
					)}
					query={query}
					tone={event.error ? "error" : "default"}
					testId="details-result"
				/>
			) : null}
			{body.resultImages ? (
				<p className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.details.images", {
						count: body.resultImages,
						n: formatCount(locale, body.resultImages),
					})}
				</p>
			) : null}
			{body.details ? (
				<JsonViewer
					value={body.details.value}
					cuts={body.details.cuts}
					label={t("sessionInsights.details.resultDetails")}
					query={query}
					testId="details-result-details"
				/>
			) : null}
		</div>
	);
}

function ContentTab({ event, body, query }: { event: TraceEvent; body: EventBody; query: string }) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<div className="flex flex-col gap-8">
			{event.kind === "mark" ? (
				<Facts>
					<Fact label={t("sessionInsights.details.kind")}>{t(MARK_TITLE[event.mark])}</Fact>
					{event.detail ? (
						<Fact label={t("sessionInsights.details.detail")}>{event.detail}</Fact>
					) : null}
					{event.tokensBefore !== undefined ? (
						<Fact label={t("sessionInsights.details.tokensBefore")}>
							{formatCount(locale, event.tokensBefore)}
						</Fact>
					) : null}
				</Facts>
			) : null}
			{body.text ? (
				<CappedTextView
					value={body.text}
					label={t("sessionInsights.details.text")}
					query={query}
					prose
				/>
			) : null}
		</div>
	);
}

function RawTab({ body, query }: { body: EventBody; query: string }) {
	const t = useT();
	const [first, second] = body.raw;
	return (
		<div className="flex flex-col gap-8">
			<p className="tr-text-metadata text-text-subtle">{t("sessionInsights.details.rawNote")}</p>
			{first ? (
				<JsonViewer
					value={first.value}
					cuts={first.cuts}
					label={t("sessionInsights.details.rawEntry", { n: 1 })}
					query={query}
					testId="details-raw"
				/>
			) : null}
			{second ? (
				<JsonViewer
					value={second.value}
					cuts={second.cuts}
					label={t("sessionInsights.details.rawEntry", { n: 2 })}
					query={query}
					testId="details-raw"
				/>
			) : null}
		</div>
	);
}

function EventLinks({
	indices,
	model,
	onSelect,
}: {
	indices: readonly number[];
	model: TraceModel;
	onSelect: (index: number) => void;
}) {
	const t = useT();
	return (
		<ul className="flex flex-col gap-2">
			{indices.map((index) => {
				const event = model.at(index);
				if (!event) return null;
				const Icon = eventIcon(event);
				return (
					<li key={event.id}>
						<button
							type="button"
							data-testid="details-link"
							onClick={() => onSelect(index)}
							className={cn(
								"flex w-full min-w-0 items-center gap-4 rounded-sm border px-8 py-2 text-left tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring",
								event.error ? "border-feedback-error-muted" : "border-border-default",
							)}
						>
							<Icon aria-hidden className={cn("size-14 shrink-0", eventTone(event))} />
							<span className="shrink-0 text-text-default">{eventTitle(t, event)}</span>
							<span className="min-w-0 truncate text-text-muted">
								{eventSubtitle(t, model, index)}
							</span>
							{event.error ? (
								<span className="ml-auto shrink-0 text-feedback-error">
									{t("sessionInsights.trace.failed")}
								</span>
							) : null}
						</button>
					</li>
				);
			})}
		</ul>
	);
}

function crumbLabel(t: Translator, event: TraceEvent): string {
	return event.kind === "turn"
		? t("sessionInsights.trace.turn", { n: event.n })
		: eventTitle(t, event);
}

export function DetailsPanel({
	host,
	sessionId,
	model,
	index,
	overview,
	query,
	onSelect,
	onZoom,
	onShowChild,
	tabsRef,
}: {
	host: PanelHost;
	sessionId: string;
	model: TraceModel;
	index: number;
	overview: SessionOverview | null;
	query: string;
	onSelect: (index: number) => void;
	onZoom: (index: number) => void;
	onShowChild?: (childId: string, eventId: string | null) => void;
	tabsRef: RefObject<HTMLDivElement | null>;
}) {
	const t = useT();
	const locale = localeOf(t);
	const event = model.at(index) ?? null;
	const [attempt, setAttempt] = useState(0);
	const state = useEventBody(host, sessionId, event?.id ?? null, attempt);
	const [lastTab, setLastTab] = useState<DetailTab | null>(null);
	const [opening, setOpening] = useState(false);
	const [notice, setNotice] = useState<{ eventId: string; text: string } | null>(null);
	const panelId = useId();
	if (!event)
		return (
			<div
				data-testid="trace-details"
				className="flex h-full flex-col items-center justify-center gap-8 p-16 text-center text-text-muted"
			>
				<RiListUnordered aria-hidden className="size-24 text-text-subtle" />
				<span className="tr-text-ui">{t("sessionInsights.details.empty")}</span>
			</div>
		);
	const tabs = tabsFor(event);
	const tab = initialTab(event, lastTab);
	const Icon = eventIcon(event);
	const target = eventRef(event.id).childId === undefined ? chatTargetOf(overview) : null;
	const crumbs = [...model.ancestors(index)].reverse();
	const openInChat = () => {
		if (!target) return;
		setOpening(true);
		loadAnchor(host, sessionId, event.id).then(
			(result) => {
				setOpening(false);
				if (!result.anchor)
					setNotice({ eventId: event.id, text: t("sessionInsights.details.notInChat") });
				host.openChat(result.anchor ? { ...target, at: result.anchor } : target);
			},
			() => {
				setOpening(false);
				setNotice({ eventId: event.id, text: t("sessionInsights.details.openFailed") });
			},
		);
	};
	const following =
		event.kind === "tool" || event.kind === "llm" ? model.following(index, NEXT_COUNT) : [];
	const body = state.kind === "ready" && state.value.found ? state.value.body : null;
	const copyRaw = () => {
		if (!body) return;
		const eventId = event.id;
		const text = JSON.stringify(
			body.raw.map((entry) => entry.value),
			null,
			2,
		);
		const failed = () => setNotice({ eventId, text: t("sessionInsights.json.copyFailed") });
		if (!navigator.clipboard) failed();
		else navigator.clipboard.writeText(text).catch(failed);
	};
	return (
		<div
			data-testid="trace-details"
			data-event-id={event.id}
			className="flex h-full min-h-0 flex-col"
		>
			<header className="flex flex-col gap-4 border-border-default border-b px-12 py-8">
				<div className="flex min-w-0 items-center gap-8">
					<Icon aria-hidden className={cn("size-16 shrink-0", eventTone(event))} />
					<h2
						data-testid="details-title"
						className="min-w-0 truncate tr-title-compact text-text-default"
					>
						{eventTitle(t, event)}
						{event.kind === "tool" && event.label ? (
							<span className="tr-code-text-small text-text-muted"> · {event.label}</span>
						) : null}
					</h2>
					{event.error ? (
						<span
							data-testid="details-status"
							className="shrink-0 rounded-sm bg-feedback-error-subtle px-4 tr-text-caption text-feedback-error"
						>
							{t("sessionInsights.trace.failed")}
						</span>
					) : null}
				</div>
				<nav
					aria-label={t("sessionInsights.details.path")}
					className="flex min-w-0 flex-wrap items-center gap-x-4 tr-text-caption text-text-subtle"
				>
					<span>{t("sessionInsights.details.session")}</span>
					{crumbs.map((at) => {
						const crumb = model.at(at);
						if (!crumb) return null;
						return (
							<span key={crumb.id} className="flex min-w-0 items-center gap-4">
								<span aria-hidden>›</span>
								<button
									type="button"
									onClick={() => onSelect(at)}
									className="min-w-0 truncate rounded-sm hover:underline focus-visible:focus-ring"
								>
									{crumbLabel(t, crumb)}
								</button>
							</span>
						);
					})}
					<span aria-hidden>›</span>
					<span className="text-text-muted">{crumbLabel(t, event)}</span>
				</nav>
				<div className="flex flex-wrap items-center gap-x-12 gap-y-2 tr-text-metadata text-text-muted">
					<span>
						{t("sessionInsights.details.start")}{" "}
						<span className="text-text-default tabular-nums">
							{formatDateTime(locale, event.t0)}
						</span>
					</span>
					{event.kind !== "turn" && event.kind !== "mark" ? (
						<span className="flex items-center gap-4">
							{t("sessionInsights.details.duration")} <TimingValue event={event} />
						</span>
					) : null}
					{event.kind === "tool" && event.resultChars !== null ? (
						<span>
							{t("sessionInsights.details.resultSize")}{" "}
							<span className="text-text-default tabular-nums">
								{formatCount(locale, event.resultChars)}
							</span>
						</span>
					) : null}
					{event.kind === "llm" ? (
						<span>
							{t("sessionInsights.details.tokens")}{" "}
							<span className="text-text-default tabular-nums">
								{formatTokens(locale, event.tokens.total)}
							</span>
						</span>
					) : null}
				</div>
				<div className="flex flex-wrap items-center gap-4">
					<Button
						variant="soft-primary"
						size="s"
						iconLeft={RiChat3Line}
						data-testid="details-open-chat"
						disabled={!target}
						loading={opening}
						tooltip={target ? undefined : t("sessionInsights.details.chatUnavailable")}
						onClick={openInChat}
					>
						{t("sessionInsights.details.openInChat")}
					</Button>
					<IconButton
						icon={RiFocus3Line}
						size="s"
						label={t("sessionInsights.details.zoom")}
						onClick={() => onZoom(index)}
					/>
					<IconButton
						icon={RiFileCopyLine}
						size="s"
						label={t("sessionInsights.details.copyRaw")}
						disabled={!body}
						onClick={copyRaw}
					/>
				</div>
				{notice && notice.eventId === event.id ? (
					<p role="status" className="tr-text-caption text-text-subtle">
						{notice.text}
					</p>
				) : null}
			</header>
			<Tabs
				id={panelId}
				label={t("sessionInsights.details.tabs")}
				tabs={tabs.map((candidate) => ({
					id: candidate,
					label: t(TAB_LABEL[candidate]),
					testId: `details-tab-${candidate}`,
					className: candidate === "result" && event.error && "text-feedback-error",
				}))}
				value={tab}
				onChange={setLastTab}
				listRef={tabsRef}
				className="flex shrink-0 items-center gap-4 border-border-default border-b px-12"
				tabClassName="h-28 px-4"
			/>
			<div
				{...tabPanel(panelId, tab)}
				data-testid="details-body"
				className="min-h-0 flex-1 overflow-auto px-12 py-8"
			>
				{state.kind === "loading" ? (
					<LoadingRegion rows={4} label={t("sessionInsights.details.loading")} className="py-4" />
				) : body ? (
					<TabBody
						host={host}
						sessionId={sessionId}
						tab={tab}
						event={event}
						body={body}
						query={query}
						model={model}
						onSelect={onSelect}
						onShowChild={onShowChild}
					/>
				) : (
					<div
						role="alert"
						className="flex flex-col items-start gap-8 tr-text-metadata text-text-muted"
					>
						<span>
							{t(
								state.kind === "ready"
									? "sessionInsights.details.gone"
									: state.kind === "version"
										? "sessionInsights.updateHost"
										: "sessionInsights.details.failed",
							)}
						</span>
						{state.kind === "failed" ? (
							<Button variant="outline" size="s" onClick={() => setAttempt(attempt + 1)}>
								{t("common.retry")}
							</Button>
						) : null}
					</div>
				)}
				{following.length > 0 ? (
					<section
						aria-label={t("sessionInsights.details.next")}
						className="mt-12 flex flex-col gap-4"
						data-testid="details-next"
					>
						<span className="tr-text-eyebrow text-text-muted">
							{t("sessionInsights.details.next")}
						</span>
						<EventLinks indices={following} model={model} onSelect={onSelect} />
					</section>
				) : null}
			</div>
		</div>
	);
}

export function TabBody({
	host,
	sessionId,
	tab,
	event,
	body,
	query,
	model,
	onSelect,
	onShowChild,
}: {
	host: PanelHost;
	sessionId: string;
	tab: DetailTab;
	event: TraceEvent;
	body: EventBody;
	query: string;
	model: TraceModel;
	onSelect: (index: number) => void;
	onShowChild?: ((childId: string, eventId: string | null) => void) | undefined;
}) {
	const t = useT();
	const locale = localeOf(t);
	switch (tab) {
		case "prompt":
			return (
				<div className="flex flex-col gap-8">
					{body.prompt ? (
						<CappedTextView
							value={body.prompt}
							label={t("sessionInsights.details.prompt")}
							query={query}
							prose
							testId="details-prompt"
						/>
					) : null}
					{body.images ? (
						<p className="tr-text-metadata text-text-subtle">
							{t("sessionInsights.details.images", {
								count: body.images,
								n: formatCount(locale, body.images),
							})}
						</p>
					) : null}
				</div>
			);
		case "reply":
			return <ReplyTab body={body} query={query} model={model} onSelect={onSelect} />;
		case "input":
			return <InputTab key={event.id} host={host} event={event} body={body} query={query} />;
		case "result":
			return <ResultTab event={event} body={body} query={query} />;
		case "subagent":
			return event.kind === "subagent" ? (
				<SubagentTab
					key={event.id}
					host={host}
					sessionId={sessionId}
					event={event}
					model={model}
					onSelect={onSelect}
					onShowChild={onShowChild}
				/>
			) : null;
		case "content":
			return <ContentTab event={event} body={body} query={query} />;
		case "raw":
			return <RawTab body={body} query={query} />;
	}
}
