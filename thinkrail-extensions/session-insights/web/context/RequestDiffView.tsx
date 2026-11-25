import {
	RiArrowRightLine,
	RiCheckboxCircleLine,
	RiErrorWarningLine,
	RiFlowChart,
	RiIndeterminateCircleLine,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	ContextCall,
	FirstDifference,
	RequestDiff,
	RequestMessage,
	RequestSide,
	SectionDiff,
	SessionContext,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { FigureBadge } from "../FigureCell";
import { formatClock, formatCount, formatDuration, formatShare, formatTokens } from "../format";
import { ShareBar } from "../ShareBar";
import { loadRequestDiff } from "../session/api";
import { useKeyedQuery } from "../useKeyedQuery";
import { causeText } from "./causes";
import { CACHE_FILL, CAUSE_LABEL, ROLE_LABEL } from "./look";

type DiffState =
	| { kind: "loading" }
	| { kind: "ready"; diff: RequestDiff }
	| { kind: "missing" }
	| { kind: "failed" };

function useRequestDiff(host: PanelHost, sessionId: string, callId: string): DiffState {
	const query = useKeyedQuery(`${sessionId}\u0000${callId}`, (signal) =>
		loadRequestDiff(host, sessionId, callId, signal),
	);
	if (query.kind === "loading") return query;
	if (query.kind !== "ready") return { kind: "failed" };
	return query.value.diff ? { kind: "ready", diff: query.value.diff } : { kind: "missing" };
}

const FLAG_TONE = {
	system: "border border-series-1 text-series-1",
	model: "border border-series-3 text-series-3",
	pause: "bg-feedback-warning-subtle text-feedback-warning",
	turn: "bg-primary-subtle text-primary",
} as const;

function Flag({ kind, label }: { kind: keyof typeof FLAG_TONE; label: string }) {
	const t = useT();
	return (
		<span
			title={label}
			className={cn(
				"inline-grid size-14 place-items-center rounded-sm tr-code-text-small",
				FLAG_TONE[kind],
			)}
		>
			{t(
				kind === "system"
					? "sessionInsights.request.flag.system"
					: kind === "model"
						? "sessionInsights.request.flag.model"
						: kind === "pause"
							? "sessionInsights.request.flag.pause"
							: "sessionInsights.request.flag.turn",
			)}
		</span>
	);
}

function RequestRow({
	call,
	previous,
	active,
	onSelect,
}: {
	call: ContextCall;
	previous: ContextCall | undefined;
	active: boolean;
	onSelect: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const changes = call.changes ?? [];
	const grew = previous ? call.total - previous.total : null;
	return (
		<button
			type="button"
			data-testid="request-row"
			data-call-id={call.id}
			data-miss={call.miss ? "true" : undefined}
			aria-pressed={active}
			tabIndex={active ? 0 : -1}
			onClick={onSelect}
			className={cn(
				"grid h-24 w-full grid-cols-[3rem_4.5rem_3rem_3.5rem_minmax(1.5rem,1fr)_4rem] items-center gap-6 border-border-default border-b px-8 text-left tr-text-metadata tabular-nums focus-visible:focus-ring-inset",
				call.miss && "bg-feedback-error-subtle",
				active ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
			)}
		>
			<span className="text-text-default">
				{t("sessionInsights.context.callShort", { n: call.n })}
			</span>
			<span className="text-text-muted">{formatClock(locale, call.t, true)}</span>
			<span className="text-text-muted">{formatTokens(locale, call.total)}</span>
			<span
				className={cn(
					"text-right",
					grew !== null && grew < 0 ? "text-feedback-success" : "text-text-default",
				)}
			>
				{grew === null ? "" : `${grew < 0 ? "−" : "+"}${formatTokens(locale, Math.abs(grew))}`}
			</span>
			<ShareBar
				total={call.total}
				parts={[
					{ key: "read", value: call.cacheRead, fill: CACHE_FILL.read },
					{ key: "write", value: call.cacheWrite, fill: CACHE_FILL.write },
					{ key: "input", value: call.input, fill: CACHE_FILL.input },
				]}
			/>
			<span className="flex justify-end gap-2">
				{changes.includes("systemPrompt") || changes.includes("tools") ? (
					<Flag kind="system" label={t("sessionInsights.request.flagLabel.system")} />
				) : null}
				{changes.includes("modelChange") || changes.includes("modelReselected") ? (
					<Flag kind="model" label={t("sessionInsights.request.flagLabel.model")} />
				) : null}
				{changes.includes("pause") ? (
					<Flag kind="pause" label={t("sessionInsights.request.flagLabel.pause")} />
				) : null}
				{previous && previous.turn !== call.turn ? (
					<Flag kind="turn" label={t("sessionInsights.request.flagLabel.turn")} />
				) : null}
			</span>
		</button>
	);
}

function SideCard({ side, bad }: { side: RequestSide; bad: boolean }) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<div
			className={cn(
				"flex min-w-0 flex-1 flex-col rounded-md border px-8 py-4",
				bad ? "border-feedback-error-muted" : "border-border-default",
			)}
		>
			<span className="tr-text-caption text-text-subtle">
				{`${t("sessionInsights.context.callShort", { n: side.n })} · ${formatClock(locale, side.t, true)}`}
			</span>
			<span className="tr-text-emphasis text-text-default tabular-nums">
				{formatCount(locale, side.total)}
			</span>
			<span className="truncate tr-text-caption text-text-muted">
				{t("sessionInsights.request.sideCache", {
					read: formatCount(locale, side.cacheRead),
					write: formatCount(locale, side.cacheWrite),
					input: formatCount(locale, side.input),
				})}
			</span>
		</div>
	);
}

function firstDifferenceText(t: Translator, first: FirstDifference): string {
	switch (first.kind) {
		case "tools":
			return t("sessionInsights.request.first.tools");
		case "system":
			return t("sessionInsights.request.first.system", { section: first.section });
		case "message":
			return t("sessionInsights.request.first.message", { index: first.index });
		case "none":
			return t("sessionInsights.request.first.none");
	}
}

function SectionRow({ section }: { section: SectionDiff }) {
	const t = useT();
	const locale = localeOf(t);
	const delta =
		section.before !== null && section.after !== null ? section.after - section.before : null;
	return (
		<li
			data-testid="request-section"
			data-status={section.status}
			className={cn(
				"flex flex-col gap-4 rounded-sm px-6 py-4",
				section.status === "removed"
					? "bg-feedback-error-subtle"
					: section.status === "same"
						? ""
						: "bg-feedback-warning-subtle",
			)}
		>
			<span className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] gap-6 tr-text-metadata tabular-nums">
				<span className="truncate tr-code-text-small text-text-default">{section.name}</span>
				<span className="text-right text-text-muted">
					{section.before === null ? "—" : formatCount(locale, section.before)}
				</span>
				<span className="text-right text-text-muted">
					{section.after === null
						? t("sessionInsights.request.removedSection")
						: formatCount(locale, section.after)}
				</span>
				<span className="text-right text-text-default">
					{delta !== null
						? `${delta < 0 ? "−" : "+"}${formatCount(locale, Math.abs(delta))}`
						: section.status === "added"
							? t("sessionInsights.request.addedSection")
							: ""}
				</span>
			</span>
			{section.diff && section.diff.length > 0 ? (
				<pre
					data-testid="request-section-diff"
					className="max-h-160 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-container-header-bg p-6 tr-code-text-small text-text-muted"
				>
					{section.diff.map((segment, at) => (
						<span
							key={`${segment.op}:${at}`}
							data-op={segment.op}
							className={cn(
								segment.op === "removed" &&
									"bg-feedback-error-subtle text-feedback-error line-through",
								segment.op === "added" && "bg-feedback-success-subtle text-feedback-success",
							)}
						>
							{segment.text}
						</span>
					))}
				</pre>
			) : null}
		</li>
	);
}

function MessageRow({ message }: { message: RequestMessage }) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<li
			data-testid="request-message"
			data-state={message.state}
			className={cn(
				"grid grid-cols-[2.5rem_1rem_7rem_minmax(0,1fr)_5rem] items-center gap-6 rounded-sm px-6 tr-text-metadata",
				message.state === "new" && "bg-feedback-success-subtle",
				message.state === "changed" && "bg-feedback-warning-subtle",
				message.state === "removed" && "bg-feedback-error-subtle",
			)}
		>
			<span className="text-right text-text-subtle tabular-nums">{message.index}</span>
			<span aria-hidden="true" className="text-text-muted">
				{message.state === "new"
					? "+"
					: message.state === "changed"
						? "~"
						: message.state === "removed"
							? "−"
							: "="}
			</span>
			<span className="truncate tr-code-text-small text-text-muted">
				{t(ROLE_LABEL[message.role])}
			</span>
			<span className="truncate text-text-default">{message.label}</span>
			<span className="text-right text-text-subtle tabular-nums">
				{t("sessionInsights.request.chars", {
					count: message.chars,
					n: formatCount(locale, message.chars),
				})}
			</span>
		</li>
	);
}

function Messages({ diff }: { diff: RequestDiff }) {
	const t = useT();
	const rows: (
		| { kind: "message"; message: RequestMessage }
		| { kind: "gap"; n: number; key: string }
	)[] = [];
	let last = 0;
	for (const message of diff.messages) {
		if (message.index > last + 1)
			rows.push({ kind: "gap", n: message.index - last - 1, key: `skip-${message.index}` });
		rows.push({ kind: "message", message });
		last = message.index;
	}
	if (diff.current.messages > last)
		rows.push({ kind: "gap", n: diff.current.messages - last, key: "skip-end" });
	return (
		<section className="flex min-w-0 flex-col gap-4 rounded-md border border-border-default p-8">
			<span className="tr-text-metadata text-text-default">
				{t("sessionInsights.request.messagesTitle", {
					before: diff.previous?.messages ?? 0,
					after: diff.current.messages,
					n: diff.newCount,
				})}
			</span>
			<ul data-testid="request-messages" className="flex flex-col gap-2">
				{rows.map((row) =>
					row.kind === "gap" ? (
						<li key={row.key} className="px-6 tr-text-caption text-text-subtle">
							{t("sessionInsights.request.unchanged", { count: row.n, n: row.n })}
						</li>
					) : (
						<MessageRow key={`${row.message.index}`} message={row.message} />
					),
				)}
			</ul>
			{diff.removedCount > 0 ? (
				<>
					<span className="tr-text-metadata text-text-default">
						{t("sessionInsights.request.removedTitle", { n: diff.removedCount })}
					</span>
					<ul data-testid="request-removed" className="flex flex-col gap-2">
						{diff.removed.map((message) => (
							<MessageRow key={`removed:${message.index}`} message={message} />
						))}
					</ul>
				</>
			) : null}
		</section>
	);
}

function DiffBody({
	diff,
	onShowInTrace,
}: {
	diff: RequestDiff;
	onShowInTrace: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { current, previous } = diff;
	const changed = diff.sections.filter((section) => section.status !== "same");
	const same = diff.sections.length - changed.length;
	const toolsChanged =
		diff.tools.added.length + diff.tools.removed.length + diff.tools.changed.length;
	return (
		<div data-testid="request-diff" className="flex min-w-0 flex-col gap-8 p-12">
			<header className="flex items-center gap-8">
				<span className="tr-title-section text-text-default">
					{t("sessionInsights.request.title", { n: current.n })}
				</span>
				{previous ? (
					<span className="tr-text-metadata text-text-muted">
						{t("sessionInsights.request.against", { n: previous.n })}
					</span>
				) : null}
				<Button
					className="ml-auto"
					variant="ghost"
					size="s"
					iconLeft={RiFlowChart}
					onClick={() => onShowInTrace(current.callId)}
				>
					{t("sessionInsights.context.showInTrace")}
				</Button>
			</header>
			{previous ? (
				<div className="flex items-stretch gap-8">
					<SideCard side={previous} bad={false} />
					<span className="flex flex-col items-center justify-center tr-text-caption text-text-subtle">
						<RiArrowRightLine aria-hidden className="size-16" />
						{diff.gapMs === null ? "" : formatDuration(t, diff.gapMs)}
					</span>
					<SideCard side={current} bad={diff.miss} />
				</div>
			) : (
				<p className="tr-text-metadata text-text-muted">
					{t("sessionInsights.request.firstRequest")}
				</p>
			)}
			<div className="flex flex-col gap-2">
				<ShareBar
					testId="request-cache-bar"
					className="h-12 flex-none"
					total={current.total}
					parts={[
						{ key: "read", value: current.cacheRead, fill: CACHE_FILL.read },
						{ key: "write", value: current.cacheWrite, fill: CACHE_FILL.write },
						{ key: "input", value: current.input, fill: CACHE_FILL.input },
					]}
				/>
				<span className="tr-text-caption text-text-muted">
					{t("sessionInsights.request.served", {
						share: formatShare(locale, current.cacheRead, current.total) ?? "—",
					})}
				</span>
			</div>
			{diff.miss ? (
				<div
					data-testid="request-miss"
					className="flex items-start gap-6 rounded-md border border-feedback-error-muted p-8 tr-text-metadata"
				>
					<RiErrorWarningLine aria-hidden className="mt-2 size-14 shrink-0 text-feedback-error" />
					<span className="text-text-default">
						{t("sessionInsights.request.missText", {
							share: formatShare(locale, current.cacheRead, current.total) ?? "—",
							first: firstDifferenceText(t, diff.firstDifference),
						})}
					</span>
					<FigureBadge origin="approximated" />
				</div>
			) : previous ? (
				<p className="tr-text-metadata text-text-muted">
					{t("sessionInsights.request.firstDifference", {
						first: firstDifferenceText(t, diff.firstDifference),
					})}
				</p>
			) : null}
			{previous ? (
				<section className="flex flex-col gap-4 rounded-md border border-border-default p-8">
					<span className="tr-text-metadata text-text-default">
						{t("sessionInsights.request.checksTitle")}
						<span className="ml-6 tr-text-caption text-text-subtle">
							{t("sessionInsights.request.checksNote")}
						</span>
					</span>
					<ul data-testid="request-checks" className="flex flex-col gap-2">
						{diff.checks.map((check) => (
							<li
								key={check.cause}
								data-testid="request-check"
								data-cause={check.cause}
								data-found={check.found}
								className={cn(
									"flex items-center gap-6 tr-text-metadata",
									check.found ? "text-text-default" : "text-text-subtle",
								)}
							>
								{check.found ? (
									<RiCheckboxCircleLine
										aria-hidden
										className="size-14 shrink-0 text-feedback-error"
									/>
								) : (
									<RiIndeterminateCircleLine aria-hidden className="size-14 shrink-0" />
								)}
								{check.found ? causeText(t, check.cause, diff.gapMs) : t(CAUSE_LABEL[check.cause])}
								<span className="sr-only">
									{t(
										check.found
											? "sessionInsights.request.checkFound"
											: "sessionInsights.request.checkClear",
									)}
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}
			<section className="flex flex-col gap-4 rounded-md border border-border-default p-8">
				<span className="tr-text-metadata text-text-default">
					{t("sessionInsights.request.systemTitle")}
					<span className="ml-6 tr-text-caption text-text-subtle">
						{t("sessionInsights.request.systemNote", {
							before: formatCount(locale, previous?.systemChars ?? 0),
							after: formatCount(locale, current.systemChars),
						})}
					</span>
				</span>
				<span className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] gap-6 px-6 tr-text-caption text-text-subtle">
					<span>{t("sessionInsights.request.section")}</span>
					<span className="text-right">
						{previous ? t("sessionInsights.context.callShort", { n: previous.n }) : "—"}
					</span>
					<span className="text-right">
						{t("sessionInsights.context.callShort", { n: current.n })}
					</span>
					<span className="text-right">{t("sessionInsights.request.delta")}</span>
				</span>
				<ul className="flex flex-col gap-2">
					{changed.map((section) => (
						<SectionRow key={section.name} section={section} />
					))}
				</ul>
				{same > 0 ? (
					<span className="px-6 tr-text-caption text-text-subtle">
						{t("sessionInsights.request.sameSections", { n: same })}
					</span>
				) : null}
				<span
					data-testid="request-tools"
					className={cn(
						"flex flex-wrap items-center gap-6 rounded-sm px-6 py-2 tr-text-metadata",
						toolsChanged > 0 ? "bg-feedback-warning-subtle" : "text-text-muted",
					)}
				>
					{t("sessionInsights.request.tools", {
						before: diff.tools.before.count,
						after: diff.tools.after.count,
						beforeChars: formatCount(locale, diff.tools.before.chars),
						afterChars: formatCount(locale, diff.tools.after.chars),
					})}
					{diff.tools.added.map((name) => (
						<span
							key={`+${name}`}
							className="tr-code-text-small text-feedback-success"
						>{`+${name}`}</span>
					))}
					{diff.tools.removed.map((name) => (
						<span
							key={`-${name}`}
							className="tr-code-text-small text-feedback-error"
						>{`−${name}`}</span>
					))}
					{diff.tools.changed.map((name) => (
						<span
							key={`~${name}`}
							className="tr-code-text-small text-feedback-warning"
						>{`~${name}`}</span>
					))}
				</span>
			</section>
			<Messages diff={diff} />
			<p className="tr-text-caption text-text-subtle">{t("sessionInsights.request.readOnly")}</p>
		</div>
	);
}

/**
 * The selected call's request reconstructed against the previous one in the session: the requests
 * around it in a list (cache split, what changed), and the diff — messages, system prompt sections
 * character by character, tools, and the cache-miss causes checked against the reconstruction.
 */
export function RequestDiffView({
	host,
	sessionId,
	data,
	selected,
	onSelect,
	onShowInTrace,
}: {
	host: PanelHost;
	sessionId: string;
	data: SessionContext;
	selected: number;
	onSelect: (index: number) => void;
	onShowInTrace: (id: string) => void;
}) {
	const t = useT();
	const call = data.calls[selected];
	const state = useRequestDiff(host, sessionId, call?.id ?? "");
	const listRef = useRef<VirtuosoHandle>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		listRef.current?.scrollIntoView({ index: selected, align: "center" });
	}, [selected]);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 20, PageUp: -20 };
		let next: number | null = null;
		if (event.key in step) next = selected + (step[event.key] ?? 0);
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = data.calls.length - 1;
		if (next === null) return;
		event.preventDefault();
		const clamped = Math.max(0, Math.min(data.calls.length - 1, next));
		onSelect(clamped);
		requestAnimationFrame(() =>
			boxRef.current
				?.querySelector<HTMLElement>('[data-testid="request-row"][aria-pressed="true"]')
				?.focus(),
		);
	};
	return (
		<ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
			<ResizablePanel defaultSize={34} minSize={22}>
				<div className="flex h-full min-h-0 flex-col border-border-default border-r">
					<div className="grid shrink-0 grid-cols-[3rem_4.5rem_3rem_3.5rem_minmax(1.5rem,1fr)_4rem] gap-6 border-border-default border-b px-8 py-2 tr-text-caption text-text-subtle">
						<span>{t("sessionInsights.context.column.call")}</span>
						<span>{t("sessionInsights.context.column.when")}</span>
						<span>{t("sessionInsights.request.column.context")}</span>
						<span className="text-right">{t("sessionInsights.request.delta")}</span>
						<span>{t("sessionInsights.request.column.cache")}</span>
						<span className="text-right">{t("sessionInsights.request.column.flags")}</span>
					</div>
					<div
						ref={boxRef}
						role="toolbar"
						aria-orientation="vertical"
						aria-label={t("sessionInsights.request.list")}
						data-testid="request-list"
						onKeyDown={onKeyDown}
						className="min-h-0 flex-1"
					>
						<Virtuoso
							ref={listRef}
							className="h-full"
							data={data.calls}
							fixedItemHeight={24}
							computeItemKey={(_, item) => item.id}
							itemContent={(index, item) => (
								<RequestRow
									call={item}
									previous={data.calls[index - 1]}
									active={index === selected}
									onSelect={() => onSelect(index)}
								/>
							)}
						/>
					</div>
					<p className="shrink-0 border-border-default border-t px-8 py-4 tr-text-caption text-text-subtle">
						{t("sessionInsights.request.flagsLegend")}
					</p>
				</div>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel defaultSize={66} minSize={40}>
				<div className="h-full min-h-0 overflow-y-auto">
					{state.kind === "loading" ? (
						<LoadingRegion rows={8} label={t("sessionInsights.request.loading")} className="p-12" />
					) : state.kind === "ready" ? (
						<DiffBody diff={state.diff} onShowInTrace={onShowInTrace} />
					) : (
						<p data-testid="request-unavailable" className="p-16 tr-text-ui text-text-muted">
							{t(
								state.kind === "missing"
									? "sessionInsights.request.missing"
									: "sessionInsights.error.failed",
							)}
						</p>
					)}
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
