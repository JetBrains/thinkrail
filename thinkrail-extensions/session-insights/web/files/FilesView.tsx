import { RiFileEditLine, RiFlowChart, RiRepeatLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	FileCell,
	FileDetail,
	FileDiff,
	FileRow,
	FileTouch,
	SessionFiles,
	SessionOverview,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useRef, useState } from "react";
import { FigureBadge, FigureDetails, type Sources } from "../FigureCell";
import { formatClock, formatCount, formatDateTime } from "../format";
import { loadFileDetail } from "../session/api";
import { useKeyedQuery } from "../useKeyedQuery";

type Filter = "all" | "changed" | "rework" | "failed";
const ROWS_SHOWN = 40;
const STRIP_W = 1000;

type DetailState =
	| { kind: "loading" }
	| { kind: "ready"; detail: FileDetail }
	| { kind: "missing" }
	| { kind: "failed" };

function useFileDetail(host: PanelHost, sessionId: string, path: string | null): DetailState {
	const query = useKeyedQuery(path === null ? null : `${sessionId}\u0000${path}`, (signal) =>
		loadFileDetail(host, sessionId, path ?? "", signal),
	);
	if (query.kind === "loading") return query;
	if (query.kind !== "ready") return { kind: "failed" };
	return query.value.detail ? { kind: "ready", detail: query.value.detail } : { kind: "missing" };
}

function changes(row: FileRow): number {
	return row.edits + row.writes;
}

function PathLabel({ path }: { path: string }) {
	const cut = path.lastIndexOf("/");
	return (
		<span className="min-w-0 truncate tr-code-text-small" title={path}>
			{cut >= 0 ? <span className="text-text-subtle">{path.slice(0, cut + 1)}</span> : null}
			<span className="text-text-default">{path.slice(cut + 1)}</span>
		</span>
	);
}

/** A cell: edits and writes as a filled square with their count, reads alone as a ring, failures marked. */
function Cell({ cell }: { cell: FileCell | undefined }) {
	const t = useT();
	if (!cell) return <td className="w-24 border-border-default border-l" />;
	const [, reads, edits, writes, failed] = cell;
	const changed = edits + writes;
	const label = t("sessionInsights.files.cellLabel", { reads, edits, writes, failed });
	return (
		<td className="relative w-24 border-border-default border-l text-center" title={label}>
			{changed > 0 ? (
				<span
					data-testid="files-cell"
					data-kind={edits > 0 ? "edit" : "write"}
					className={cn(
						"inline-grid h-14 w-16 place-items-center rounded-sm tr-code-text-small text-text-on-primary",
						edits > 0 ? "bg-series-2" : "bg-series-4",
						reads > 0 && "border-2 border-series-5",
					)}
				>
					{changed > 1 ? changed : ""}
				</span>
			) : reads > 0 ? (
				<span
					data-testid="files-cell"
					data-kind="read"
					className="inline-grid size-14 place-items-center rounded-full border-2 border-series-5 tr-code-text-small text-series-5"
				>
					{reads > 1 ? reads : ""}
				</span>
			) : null}
			{failed > 0 ? (
				<span
					data-testid="files-failed"
					className={cn(
						"size-6 rotate-45 rounded-sm bg-feedback-error",
						changed + reads > 0 ? "absolute top-2 right-2" : "inline-block",
					)}
				/>
			) : null}
			<span className="sr-only">{label}</span>
		</td>
	);
}

function columnHeading(files: SessionFiles, at: number): string {
	const column = files.cols[at];
	if (!column) return "";
	if (files.columns === "steps") return column.stepN === null ? "·" : String(column.stepN);
	return column.turnN === null ? "·" : String(column.turnN);
}

function columnTitle(t: Translator, files: SessionFiles, at: number): string {
	const column = files.cols[at];
	if (!column) return "";
	if (files.columns === "steps")
		return column.stepN === null
			? t("sessionInsights.files.outsidePlan")
			: t("sessionInsights.files.stepTitle", { n: column.stepN, title: column.title });
	return t("sessionInsights.files.turnTitle", { n: column.turnN ?? 0, title: column.title });
}

function Matrix({
	files,
	rows,
	selected,
	onSelect,
}: {
	files: SessionFiles;
	rows: readonly FileRow[];
	selected: string | null;
	onSelect: (path: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const bodyRef = useRef<HTMLTableSectionElement>(null);
	const turnGroups: { key: string; n: number | null; title: string; span: number }[] = [];
	if (files.columns === "steps")
		for (const column of files.cols) {
			const last = turnGroups.at(-1);
			if (last && last.n === column.turnN) last.span += 1;
			else
				turnGroups.push({
					key: `${column.turnId}:${turnGroups.length}`,
					n: column.turnN,
					title: column.turnId ?? "",
					span: 1,
				});
		}
	const focusRow = (at: number) =>
		bodyRef.current?.querySelectorAll<HTMLElement>("[data-row-button]")[at]?.focus();
	const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
		const buttons = [
			...(bodyRef.current?.querySelectorAll<HTMLElement>("[data-row-button]") ?? []),
		];
		const at = buttons.indexOf(document.activeElement as HTMLElement);
		if (at === -1) return;
		const next =
			event.key === "ArrowDown"
				? at + 1
				: event.key === "ArrowUp"
					? at - 1
					: event.key === "Home"
						? 0
						: event.key === "End"
							? buttons.length - 1
							: null;
		if (next === null) return;
		event.preventDefault();
		focusRow(Math.max(0, Math.min(buttons.length - 1, next)));
	};
	const active = selected ?? rows[0]?.path ?? null;
	return (
		<div className="min-w-0 overflow-x-auto">
			<table data-testid="files-matrix" className="border-collapse tr-text-metadata">
				<thead>
					{files.columns === "steps" ? (
						<tr className="tr-text-caption text-text-subtle">
							<th className="sticky left-0 z-10 bg-container-workspace-bg px-8 text-left font-normal">
								{t("sessionInsights.files.turnsToSteps")}
							</th>
							{turnGroups.map((group) => (
								<th
									key={group.key}
									colSpan={group.span}
									className="max-w-0 truncate border-border-default border-l px-4 text-left font-normal"
								>
									{group.n === null ? "·" : t("sessionInsights.trace.turn", { n: group.n })}
								</th>
							))}
							<th colSpan={5} />
						</tr>
					) : null}
					<tr className="border-border-default border-b tr-text-caption text-text-subtle">
						<th className="sticky left-0 z-10 bg-container-workspace-bg px-8 text-left font-normal">
							{t("sessionInsights.files.column.file")}
						</th>
						{files.cols.map((column, at) => (
							<th
								key={`${column.turnId}:${column.stepId}`}
								title={columnTitle(t, files, at)}
								className="w-24 border-border-default border-l text-center font-normal tabular-nums"
							>
								{columnHeading(files, at)}
							</th>
						))}
						<th className="w-32 px-4 text-right font-normal">
							{t("sessionInsights.files.column.reads")}
						</th>
						<th className="w-32 px-4 text-right font-normal">
							{t("sessionInsights.files.column.edits")}
						</th>
						<th className="w-32 px-4 text-right font-normal">
							{t("sessionInsights.files.column.writes")}
						</th>
						<th className="w-96 px-4 text-right font-normal">
							{t("sessionInsights.files.column.lines")}
						</th>
						<th className="w-80 px-4 font-normal" />
					</tr>
				</thead>
				<tbody ref={bodyRef} onKeyDown={onKeyDown}>
					{rows.map((row) => {
						const byColumn = new Map(row.cells.map((cell) => [cell[0], cell]));
						return (
							<tr
								key={row.path}
								data-testid="files-row"
								data-path={row.path}
								data-rework={row.rework ? "true" : undefined}
								className={cn(
									"h-24 border-border-default border-b",
									row.rework && "bg-feedback-error-subtle",
									row.path === selected && "bg-control-bg-selected",
								)}
							>
								<th
									scope="row"
									className={cn(
										"sticky left-0 z-10 max-w-320 bg-container-workspace-bg p-0 text-left font-normal",
										row.rework && "border-l-2 border-l-feedback-error",
									)}
								>
									<button
										type="button"
										data-row-button
										aria-pressed={row.path === selected}
										tabIndex={row.path === active ? 0 : -1}
										onClick={() => onSelect(row.path)}
										className={cn(
											"flex h-24 w-full min-w-0 items-center px-8 text-left hover:bg-control-bg-hovered focus-visible:focus-ring-inset",
											row.path === selected
												? "bg-control-bg-selected"
												: row.rework && "bg-feedback-error-subtle",
										)}
									>
										<PathLabel path={row.path} />
									</button>
								</th>
								{files.cols.map((column, at) => (
									<Cell key={`${column.turnId}:${column.stepId}`} cell={byColumn.get(at)} />
								))}
								<td className="px-4 text-right text-text-muted tabular-nums">{row.reads || "·"}</td>
								<td className="px-4 text-right text-text-muted tabular-nums">{row.edits || "·"}</td>
								<td className="px-4 text-right text-text-muted tabular-nums">
									{row.writes || "·"}
								</td>
								<td className="whitespace-nowrap px-4 text-right tabular-nums">
									<span className="text-feedback-success">{`+${formatCount(locale, row.added)}`}</span>{" "}
									<span className="text-feedback-error">{`−${formatCount(locale, row.removed)}`}</span>
								</td>
								<td className="px-4">
									<span className="flex items-center justify-end gap-4">
										{row.rework ? (
											<span
												data-testid="files-rework"
												className="inline-flex items-center gap-2 rounded-sm bg-feedback-error-subtle px-4 tr-text-caption text-feedback-error tabular-nums"
											>
												<RiRepeatLine aria-hidden className="size-12" />
												{t("sessionInsights.files.reworkTimes", { n: changes(row) })}
											</span>
										) : null}
										{row.failed > 0 ? (
											<span className="tr-text-caption text-feedback-error tabular-nums">
												{t("sessionInsights.files.failedCount", { n: row.failed })}
											</span>
										) : null}
									</span>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function TouchStrip({
	touches,
	start,
	end,
}: {
	touches: readonly FileTouch[];
	start: number;
	end: number;
}) {
	const span = Math.max(1, end - start);
	const x = (time: number) => ((time - start) / span) * STRIP_W;
	return (
		<svg
			aria-hidden="true"
			data-testid="files-strip"
			viewBox={`0 0 ${STRIP_W} 20`}
			preserveAspectRatio="none"
			className="block h-20 w-full rounded-sm bg-container-header-bg"
		>
			{touches.map((touch) => (
				<rect
					key={touch.eventId}
					x={x(touch.t) - 1}
					y={touch.op === "read" ? 12 : 3}
					width={3}
					height={touch.op === "read" ? 6 : 9}
					className={
						touch.failed
							? "fill-feedback-error"
							: touch.op === "read"
								? "fill-series-5"
								: touch.op === "edit"
									? "fill-series-2"
									: "fill-series-4"
					}
				/>
			))}
		</svg>
	);
}

function DiffBlock({
	diff,
	canOpen,
	onOpenAt,
	onShowInTrace,
}: {
	diff: FileDiff;
	canOpen: boolean;
	onOpenAt: (line: number) => void;
	onShowInTrace: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const lines = diff.text.text.split("\n");
	return (
		<li data-testid="files-diff" data-op={diff.op} className="flex flex-col gap-2">
			<span className="flex flex-wrap items-center gap-6 tr-text-caption text-text-muted">
				<span className="text-text-default">
					{t(
						diff.op === "edit" ? "sessionInsights.files.op.edit" : "sessionInsights.files.op.write",
					)}
				</span>
				<span className="tabular-nums">{formatClock(locale, diff.t, true)}</span>
				{diff.line !== null ? (
					<span>{t("sessionInsights.files.atLine", { n: diff.line })}</span>
				) : null}
				<span className="ml-auto flex gap-4">
					{canOpen && diff.line !== null ? (
						<Button
							variant="ghost"
							size="s"
							onClick={() => diff.line !== null && onOpenAt(diff.line)}
						>
							{t("sessionInsights.files.openAtLine")}
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="s"
						iconLeft={RiFlowChart}
						onClick={() => onShowInTrace(diff.eventId)}
					>
						{t("sessionInsights.context.showInTrace")}
					</Button>
				</span>
			</span>
			<pre className="max-h-240 overflow-auto rounded-sm bg-container-header-bg p-6 tr-code-text-small">
				{lines.map((line, at) => {
					const kind =
						diff.op === "write"
							? "added"
							: line.startsWith("+++") || line.startsWith("---")
								? "meta"
								: line.startsWith("+")
									? "added"
									: line.startsWith("-")
										? "removed"
										: line.startsWith("@@")
											? "meta"
											: "same";
					return (
						<span
							key={`${at}:${line.length}`}
							className={cn(
								"block whitespace-pre",
								kind === "added" && "bg-feedback-success-subtle text-feedback-success",
								kind === "removed" && "bg-feedback-error-subtle text-feedback-error",
								kind === "meta" && "text-text-subtle",
								kind === "same" && "text-text-muted",
							)}
						>
							{diff.op === "write" ? `+${line}` : line || " "}
						</span>
					);
				})}
				{diff.text.cut ? (
					<span className="block text-text-subtle">
						{t("sessionInsights.files.cut", { chars: formatCount(locale, diff.text.chars) })}
					</span>
				) : null}
			</pre>
		</li>
	);
}

function Detail({
	host,
	sessionId,
	overview,
	path,
	sources,
	span,
	onShowInTrace,
}: {
	host: PanelHost;
	sessionId: string;
	overview: SessionOverview | null;
	path: string;
	sources: Sources;
	span: { start: number; end: number };
	onShowInTrace: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const state = useFileDetail(host, sessionId, path);

	if (state.kind === "loading")
		return <LoadingRegion rows={4} label={t("sessionInsights.files.loading")} className="p-12" />;
	if (state.kind !== "ready")
		return (
			<p className="p-12 tr-text-metadata text-text-muted">
				{t(
					state.kind === "missing"
						? "sessionInsights.files.missing"
						: "sessionInsights.error.failed",
				)}
			</p>
		);
	const { detail } = state;
	const { row } = detail;
	const workspaceId =
		overview?.workspaceState === "open" && overview.workspaceId ? overview.workspaceId : null;
	const canOpen = row.inside && workspaceId !== null;
	const lastLine = [...detail.touches].reverse().find((touch) => touch.line !== null)?.line ?? null;
	const reason = !row.inside
		? t("sessionInsights.files.outside")
		: t("sessionInsights.files.workspaceClosed");
	return (
		<section
			data-testid="files-detail"
			data-path={row.path}
			aria-label={row.path}
			className="flex min-w-0 flex-col gap-8 rounded-md border border-border-default p-8"
		>
			<header className="flex min-w-0 flex-wrap items-center gap-8">
				<RiFileEditLine aria-hidden className="size-16 shrink-0 text-text-muted" />
				<PathLabel path={row.path} />
				{row.rework ? (
					<span className="rounded-full border border-feedback-error-muted px-6 tr-text-caption text-feedback-error">
						{t("sessionInsights.files.reworkBadge")}
					</span>
				) : null}
				<Button
					className="ml-auto"
					variant="outline"
					size="s"
					data-testid="files-open"
					disabled={!canOpen}
					tooltip={canOpen ? undefined : reason}
					onClick={() => {
						if (workspaceId) host.openFile(workspaceId, row.path, lastLine ?? undefined);
					}}
				>
					{t("sessionInsights.files.open")}
				</Button>
			</header>
			<span className="flex flex-wrap items-center gap-6 tr-text-metadata text-text-muted">
				{t("sessionInsights.files.counts", {
					reads: row.reads,
					edits: row.edits,
					writes: row.writes,
				})}
				{row.failed > 0 ? (
					<span className="text-feedback-error">
						{t("sessionInsights.files.failedEdits", { n: row.failed })}
					</span>
				) : null}
				<IconTooltip
					label={
						<FigureDetails
							figures={[
								{
									metric: "fileLines",
									origin: "approximated",
									exact: `+${formatCount(locale, row.added)} −${formatCount(locale, row.removed)}`,
								},
							]}
							sources={sources}
						/>
					}
				>
					<button
						type="button"
						className="inline-flex items-center gap-4 rounded-sm tabular-nums focus-visible:focus-ring"
					>
						<span className="text-feedback-success">{`+${formatCount(locale, row.added)}`}</span>
						<span className="text-feedback-error">{`−${formatCount(locale, row.removed)}`}</span>
						<span className="rounded-full border border-border-default px-4 tr-text-caption text-text-subtle">
							{t("sessionInsights.files.fromToolCalls")}
						</span>
					</button>
				</IconTooltip>
				{row.receipt ? (
					<IconTooltip
						label={
							<FigureDetails
								figures={[
									{
										metric: "fileReceipt",
										origin: "host",
										exact: `+${formatCount(locale, row.receipt.added)} −${formatCount(locale, row.receipt.removed)}`,
									},
								]}
								sources={sources}
							/>
						}
					>
						<button
							type="button"
							data-testid="files-receipt"
							className="rounded-sm tabular-nums focus-visible:focus-ring"
						>
							{t("sessionInsights.files.receipt", {
								added: formatCount(locale, row.receipt.added),
								removed: formatCount(locale, row.receipt.removed),
								runs: row.receipt.runs,
							})}
						</button>
					</IconTooltip>
				) : null}
			</span>
			<TouchStrip touches={detail.touches} start={span.start} end={span.end} />
			<ul data-testid="files-touches" className="flex flex-wrap gap-4">
				{detail.touches.map((touch) => (
					<li key={touch.eventId}>
						<button
							type="button"
							data-testid="files-touch"
							data-op={touch.op}
							data-failed={touch.failed ? "true" : undefined}
							onClick={() => onShowInTrace(touch.eventId)}
							className={cn(
								"rounded-sm border px-4 tr-text-caption tabular-nums hover:bg-control-bg-hovered focus-visible:focus-ring",
								touch.failed
									? "border-feedback-error-muted text-feedback-error"
									: "border-border-default text-text-muted",
							)}
						>
							{`${formatClock(locale, touch.t, false)} · ${t(
								touch.op === "read"
									? "sessionInsights.files.op.read"
									: touch.op === "edit"
										? "sessionInsights.files.op.edit"
										: "sessionInsights.files.op.write",
							)}${touch.failed ? ` · ${t("sessionInsights.files.failed")}` : ""}`}
						</button>
					</li>
				))}
			</ul>
			{detail.receipts.length > 0 ? (
				<ul className="flex flex-col gap-2 tr-text-caption text-text-muted">
					{detail.receipts.map((receipt) => (
						<li key={receipt.startedAt}>
							{t("sessionInsights.files.receiptRun", {
								when: formatDateTime(locale, receipt.startedAt),
								status: receipt.status,
								added: receipt.added ?? 0,
								removed: receipt.removed ?? 0,
							})}
						</li>
					))}
				</ul>
			) : null}
			<span className="flex items-center gap-6 tr-text-metadata text-text-default">
				{t("sessionInsights.files.diffsTitle")}
				<FigureBadge origin="approximated" />
				<span className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.files.diffsNote")}
				</span>
			</span>
			{detail.diffs.length === 0 ? (
				<p className="tr-text-metadata text-text-muted">{t("sessionInsights.files.noDiffs")}</p>
			) : (
				<ol className="flex flex-col gap-8">
					{detail.diffs.map((diff) => (
						<DiffBlock
							key={diff.eventId}
							diff={diff}
							canOpen={canOpen}
							onOpenAt={(line) => {
								if (workspaceId) host.openFile(workspaceId, row.path, line);
							}}
							onShowInTrace={onShowInTrace}
						/>
					))}
				</ol>
			)}
			{detail.moreDiffs > 0 ? (
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.files.moreDiffs", { n: detail.moreDiffs })}
				</span>
			) : null}
		</section>
	);
}

/**
 * The session's files × turns (or plan steps inside few turns): reads as rings, edits and writes as
 * filled squares with counts, failed edits marked, rework rows highlighted; a selected file shows its
 * touches over time and the diffs its edit and write calls recorded (analytics only, from tool calls).
 */
export function FilesView({
	host,
	sessionId,
	overview,
	files,
	sources,
	onShowInTrace,
}: {
	host: PanelHost;
	sessionId: string;
	overview: SessionOverview | null;
	files: SessionFiles;
	sources: Sources;
	onShowInTrace: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [filter, setFilter] = useState<Filter>("all");
	const [shown, setShown] = useState(ROWS_SHOWN);
	const [selected, setSelected] = useState<string | null>(null);
	const rows = files.rows.filter((row) =>
		filter === "changed"
			? changes(row) > 0
			: filter === "rework"
				? row.rework
				: filter === "failed"
					? row.failed > 0
					: true,
	);
	const filters: { id: Filter; label: string }[] = [
		{ id: "all", label: t("sessionInsights.files.filter.all", { n: files.totals.files }) },
		{
			id: "changed",
			label: t("sessionInsights.files.filter.changed", { n: files.totals.changed }),
		},
		{ id: "rework", label: t("sessionInsights.files.filter.rework", { n: files.totals.rework }) },
		{
			id: "failed",
			label: t("sessionInsights.files.filter.failed", {
				n: files.rows.filter((row) => row.failed > 0).length,
			}),
		},
	];
	if (files.rows.length === 0)
		return (
			<p data-testid="files-empty" className="p-16 text-center tr-text-ui text-text-muted">
				{t("sessionInsights.files.empty")}
			</p>
		);
	return (
		<div data-testid="files-view" className="flex h-full min-h-0 flex-col overflow-y-auto">
			<div
				role="toolbar"
				aria-label={t("sessionInsights.files.toolbar")}
				className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-b px-12 py-4"
			>
				<fieldset aria-label={t("sessionInsights.files.filters")} className="flex gap-4">
					{filters.map((item) => (
						<ToggleSegment
							key={item.id}
							testid={`files-filter-${item.id}`}
							label={item.label}
							active={filter === item.id}
							onClick={() => {
								setFilter(item.id);
								setShown(ROWS_SHOWN);
							}}
						/>
					))}
				</fieldset>
				<span
					data-testid="files-summary"
					className="ml-auto tr-text-metadata text-text-muted tabular-nums"
				>
					{t(
						files.columns === "steps"
							? "sessionInsights.files.summarySteps"
							: "sessionInsights.files.summaryTurns",
						{
							files: formatCount(locale, files.totals.files),
							changed: formatCount(locale, files.totals.changed),
							rework: formatCount(locale, files.totals.rework),
							added: formatCount(locale, files.totals.added),
							removed: formatCount(locale, files.totals.removed),
						},
					)}
				</span>
			</div>
			<div className="flex flex-col gap-8 p-12">
				<Matrix
					files={files}
					rows={rows.slice(0, shown)}
					selected={selected}
					onSelect={setSelected}
				/>
				{rows.length > shown ? (
					<Button variant="ghost" size="s" onClick={() => setShown(shown + ROWS_SHOWN)}>
						{t("sessionInsights.more", { count: Math.min(ROWS_SHOWN, rows.length - shown) })}
					</Button>
				) : null}
				{files.hidden > 0 ? (
					<span className="tr-text-caption text-text-subtle">
						{t("sessionInsights.files.hidden", { count: files.hidden, n: files.hidden })}
					</span>
				) : null}
				<div
					data-testid="files-legend"
					className="flex flex-wrap items-center gap-x-12 gap-y-4 tr-text-caption text-text-muted"
				>
					<span className="inline-flex items-center gap-4">
						<span className="size-12 rounded-full border-2 border-series-5" />
						{t("sessionInsights.files.legend.read")}
					</span>
					<span className="inline-flex items-center gap-4">
						<span className="h-12 w-14 rounded-sm bg-series-2" />
						{t("sessionInsights.files.legend.edit")}
					</span>
					<span className="inline-flex items-center gap-4">
						<span className="h-12 w-14 rounded-sm bg-series-4" />
						{t("sessionInsights.files.legend.write")}
					</span>
					<span className="inline-flex items-center gap-4">
						<span className="size-6 rotate-45 rounded-sm bg-feedback-error" />
						{t("sessionInsights.files.legend.failed")}
					</span>
					<span className="inline-flex items-center gap-4">
						<span className="h-12 w-2 bg-feedback-error" />
						{t("sessionInsights.files.legend.rework")}
					</span>
					{files.columns === "steps" ? (
						<span>{t("sessionInsights.files.legend.steps")}</span>
					) : null}
				</div>
				{selected !== null ? (
					<Detail
						key={selected}
						host={host}
						sessionId={sessionId}
						overview={overview}
						path={selected}
						sources={sources}
						span={{ start: files.start ?? 0, end: files.end ?? 0 }}
						onShowInTrace={onShowInTrace}
					/>
				) : (
					<p className="tr-text-metadata text-text-muted">{t("sessionInsights.files.pick")}</p>
				)}
			</div>
		</div>
	);
}
