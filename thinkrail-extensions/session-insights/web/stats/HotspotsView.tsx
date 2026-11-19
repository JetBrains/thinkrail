import {
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiCheckboxCircleLine,
	RiExternalLinkLine,
	RiFilter3Line,
	RiFlowChart,
	RiListUnordered,
	RiNodeTree,
} from "@remixicon/react";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	HotspotAction,
	HotspotFile,
	HotspotSort,
	SessionRef,
	StatsHotspotsResult,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, useState } from "react";
import { sessionName } from "../copy";
import { formatCount, formatDay } from "../format";
import { ShareBar } from "../ShareBar";
import { ACTION_LABEL, ACTION_RULE, ACTION_SIGNAL, ACTION_STEPS, SORT_LABEL } from "./copy";
import { Fig } from "./Fig";
import { fileKey, HeatTree } from "./HeatTree";

const SORTS: readonly HotspotSort[] = ["touches", "changes", "sessions"];
const ACTIONS: readonly HotspotAction[] = [
	"split",
	"test",
	"spec",
	"plan",
	"template",
	"hub",
	"upfront",
	"review",
	"none",
];
const PAGE = 40;

const ACTION_TONE = {
	spec: "border-feedback-info-muted bg-feedback-info-subtle text-feedback-info",
	test: "border-feedback-error-muted bg-feedback-error-subtle text-feedback-error",
	plan: "border-feedback-warning-muted bg-feedback-warning-subtle text-feedback-warning",
	template: "border-border-default text-text-default",
	split: "border-feedback-error-muted bg-feedback-error-subtle text-feedback-error",
	hub: "border-primary-muted bg-primary-subtle text-text-default",
	upfront: "border-primary-muted bg-primary-subtle text-text-default",
	review: "border-border-default text-text-default",
	none: "border-transparent text-text-muted",
} as const satisfies Record<HotspotAction, string>;

export type ShowSessions = (label: string, ids: readonly string[]) => void;

/** The ranked list, or the heat tree of the same files. */
export type HotspotsLayout = "list" | "tree";

function split(path: string): { dir: string; name: string } {
	const at = path.lastIndexOf("/");
	return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

function changesOf(file: HotspotFile): number {
	return file.edits + file.writes;
}

/** The row's short signal: the facts its action's rule matched. */
function signal(t: Translator, locale: string, file: HotspotFile): string {
	const count = (value: number) => formatCount(locale, value);
	switch (file.action) {
		case "spec":
		case "template":
		case "hub":
			return t(ACTION_SIGNAL[file.action], {
				changed: count(file.changedSessions),
				sessions: count(file.sessions.length),
			});
		case "test":
		case "plan":
		case "split":
		case "review":
			return t(ACTION_SIGNAL[file.action], { changes: count(file.rework) });
		case "upfront":
			return t("sessionInsights.hotspots.signal.upfront", {
				reads: count(file.reads),
				touches: count(file.touches.value ?? 0),
				sessions: count(file.sessions.length),
			});
		case "none":
			return file.changedSessions > 0
				? t("sessionInsights.hotspots.signal.changedIn", { count: file.changedSessions })
				: t("sessionInsights.hotspots.signal.readIn", { count: file.sessions.length });
	}
}

/** Why a file is hot and what its action suggests, with the sessions and the file to open. */
export function HotspotDetail({
	file,
	result,
	onShowSessions,
	onOpenSession,
	onOpenFile,
}: {
	file: HotspotFile;
	result: StatsHotspotsResult;
	onShowSessions: ShowSessions;
	onOpenSession: (session: SessionRef, eventId: string | null) => void;
	onOpenFile: (workspaceId: string, path: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const top = file.reworkSession === null ? null : (result.sessions[file.reworkSession] ?? null);
	const refs = file.sessions.flatMap((index) => {
		const ref = result.sessions[index];
		return ref ? [ref] : [];
	});
	const latest = refs[0] ?? null;
	const rules = result.hotspots.rules;
	return (
		<div
			data-testid="hotspot-detail"
			data-path={file.path}
			className="grid grid-cols-1 gap-12 border-primary border-l-2 bg-control-bg px-12 py-8 @[48rem]:grid-cols-2"
		>
			<div className="flex min-w-0 flex-col gap-4">
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.hotspots.why")}
				</span>
				<p className="tr-text-ui text-text-muted">
					{t("sessionInsights.hotspots.whyFacts", {
						edits: formatCount(locale, file.edits),
						writes: formatCount(locale, file.writes),
						reads: formatCount(locale, file.reads),
						sessions: formatCount(locale, file.sessions.length),
					})}{" "}
					{top && file.rework > 0
						? t("sessionInsights.hotspots.whyTop", {
								changes: formatCount(locale, file.rework),
								session: sessionName(t, top),
								day: top.start === null ? "" : formatDay(locale, top.start),
							})
						: null}{" "}
					{file.failed > 0 ? t("sessionInsights.hotspots.whyFailed", { count: file.failed }) : null}{" "}
					{changesOf(file) > file.reads ? t("sessionInsights.hotspots.whyPieces") : null}
				</p>
				<p data-testid="hotspot-rule" className="tr-text-metadata text-text-subtle">
					{t(ACTION_RULE[file.action], {
						specSessions: rules.specSessions,
						templateSessions: rules.templateSessions,
						splitChanges: rules.splitChanges,
						hubSessions: rules.hubSessions,
						readShare: Math.round(rules.readShare * 100),
						readSessions: rules.readSessions,
						rework: result.hotspots.reworkChanges,
					})}
				</p>
			</div>
			<div className="flex min-w-0 flex-col gap-4">
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.hotspots.whatToDo")}
				</span>
				{ACTION_STEPS[file.action].map((step) => (
					<span key={step} className="flex items-start gap-6 tr-text-ui text-text-default">
						<RiCheckboxCircleLine
							aria-hidden
							className="mt-2 size-14 shrink-0 text-feedback-success"
						/>
						{t(step)}
					</span>
				))}
				<span className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.findings.notApplied")}
				</span>
				<div className="flex flex-wrap gap-4">
					{(top ?? latest) ? (
						<Button
							variant="outline"
							size="s"
							iconLeft={RiFlowChart}
							data-testid="hotspot-open-session"
							onClick={() => {
								const ref = top ?? latest;
								if (ref) onOpenSession(ref, null);
							}}
						>
							{t("sessionInsights.hotspots.openSession")}
						</Button>
					) : null}
					<Button
						variant="outline"
						size="s"
						iconLeft={RiFilter3Line}
						data-testid="hotspot-show-sessions"
						onClick={() =>
							onShowSessions(
								file.path,
								refs.map((ref) => ref.sessionId),
							)
						}
					>
						{t("sessionInsights.findings.showSessions")}
					</Button>
					<Button
						variant="outline"
						size="s"
						iconLeft={RiExternalLinkLine}
						data-testid="hotspot-open-file"
						disabled={file.workspaceId === null}
						tooltip={
							file.workspaceId === null ? t("sessionInsights.hotspots.noWorkspace") : undefined
						}
						onClick={() => {
							if (file.workspaceId) onOpenFile(file.workspaceId, file.path);
						}}
					>
						{t("sessionInsights.hotspots.openFile")}
					</Button>
				</div>
			</div>
		</div>
	);
}

function HotspotRow({
	file,
	rank,
	max,
	open,
	projectName,
	result,
	onToggle,
}: {
	file: HotspotFile;
	rank: number;
	max: number;
	open: boolean;
	projectName: string | null;
	result: StatsHotspotsResult;
	onToggle: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { dir, name } = split(file.path);
	return (
		<tr
			data-testid="hotspot-row"
			data-path={file.path}
			data-action={file.action}
			data-rework={file.rework >= result.hotspots.reworkChanges}
			className={cn("border-border-muted border-t", open && "bg-control-bg")}
		>
			<td className="px-8 py-2 text-right tr-text-caption text-text-subtle tabular-nums">{rank}</td>
			<td className="max-w-0 px-8 py-2">
				<span className="flex min-w-0 flex-col">
					<span className="truncate tr-code-text-small text-text-default">{name}</span>
					<span className="truncate tr-code-text-small text-text-subtle">
						{[projectName, dir ? `${dir}/` : "./"].filter(Boolean).join(" · ")}
					</span>
				</span>
			</td>
			<td className="px-8 py-2 text-right tabular-nums">
				<Fig
					text={formatCount(locale, file.touches.value ?? 0)}
					origin={file.touches.origin}
					sources={result.sources}
					testId="hotspot-touches"
					figures={[
						{
							metric: "hotspots",
							origin: file.touches.origin,
							exact: formatCount(locale, file.touches.value ?? 0),
							detail: t("sessionInsights.hotspots.touchesDetail", {
								reads: formatCount(locale, file.reads),
								edits: formatCount(locale, file.edits),
								writes: formatCount(locale, file.writes),
								failed: formatCount(locale, file.failed),
								added: formatCount(locale, file.added),
								removed: formatCount(locale, file.removed),
							}),
						},
					]}
				/>
			</td>
			<td className="w-96 px-8 py-2">
				<ShareBar
					total={max}
					parts={[
						{ key: "reads", value: file.reads, fill: "fill-series-5" },
						{ key: "edits", value: file.edits, fill: "fill-series-2" },
						{ key: "writes", value: file.writes, fill: "fill-series-4" },
					]}
				/>
			</td>
			<td className="px-8 py-2 text-right tabular-nums">
				{formatCount(locale, file.sessions.length)}
			</td>
			<td className="max-w-0 px-8 py-2">
				<span
					data-testid="hotspot-signal"
					className={cn(
						"block truncate tr-text-metadata",
						file.action === "none" ? "text-text-subtle" : "text-text-muted",
					)}
				>
					{signal(t, locale, file)}
				</span>
			</td>
			<td className="px-8 py-2">
				<button
					type="button"
					data-testid="hotspot-action"
					aria-expanded={open}
					onClick={onToggle}
					className={cn(
						"flex w-full min-w-0 items-center gap-4 rounded-sm border px-6 py-2 text-left tr-text-metadata focus-visible:focus-ring",
						ACTION_TONE[file.action],
					)}
				>
					{open ? (
						<RiArrowDownSLine aria-hidden className="size-14 shrink-0" />
					) : (
						<RiArrowRightSLine aria-hidden className="size-14 shrink-0" />
					)}
					<span className="truncate">{t(ACTION_LABEL[file.action])}</span>
				</button>
			</td>
		</tr>
	);
}

/**
 * File hotspots across sessions: a ranked list with one rule-based action per file and its "why", or
 * the heat tree of the same files. Workspace-relative paths only.
 */
export function HotspotsView({
	result,
	busy = false,
	sort,
	onSort,
	view,
	onView,
	onShowSessions,
	onOpenSession,
	onOpenFile,
}: {
	result: StatsHotspotsResult;
	/** Another sort is loading: the controls stay, the results show a skeleton. */
	busy?: boolean;
	sort: HotspotSort;
	onSort: (sort: HotspotSort) => void;
	view: HotspotsLayout;
	onView: (view: HotspotsLayout) => void;
	onShowSessions: ShowSessions;
	onOpenSession: (session: SessionRef, eventId: string | null) => void;
	onOpenFile: (workspaceId: string, path: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { hotspots } = result;
	const [action, setAction] = useState<HotspotAction | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [shown, setShown] = useState(PAGE);
	const names = new Map(hotspots.projects.map((project) => [project.id, project.name]));
	const many = new Set(hotspots.files.map((file) => file.projectId)).size > 1;
	const files = action ? hotspots.files.filter((file) => file.action === action) : hotspots.files;
	const max = Math.max(1, ...files.map((file) => file.touches.value ?? 0));
	const detail = (file: HotspotFile) => (
		<HotspotDetail
			file={file}
			result={result}
			onShowSessions={onShowSessions}
			onOpenSession={onOpenSession}
			onOpenFile={onOpenFile}
		/>
	);
	return (
		<div data-testid="hotspots-view" className="@container flex min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-8 border-border-default border-b px-12 py-4">
				<span className="tr-text-metadata text-text-muted">
					{t("sessionInsights.hotspots.scope", {
						sessions: formatCount(locale, result.sessions.length),
						files: formatCount(locale, hotspots.totalFiles),
						touches: formatCount(locale, hotspots.touches),
					})}
				</span>
				<span className="ml-auto flex flex-wrap items-center gap-4">
					<fieldset aria-label={t("sessionInsights.hotspots.sortLabel")} className="flex gap-2">
						{SORTS.map((item) => (
							<ToggleSegment
								key={item}
								testid={`hotspots-sort-${item}`}
								label={t(SORT_LABEL[item])}
								active={sort === item}
								onClick={() => onSort(item)}
							/>
						))}
					</fieldset>
					<fieldset
						aria-label={t("sessionInsights.hotspots.viewLabel")}
						className="flex items-center gap-2 border-border-default border-l pl-4"
					>
						<IconButton
							icon={RiListUnordered}
							size="s"
							label={t("sessionInsights.hotspots.list")}
							data-testid="hotspots-view-list"
							aria-pressed={view === "list"}
							selected={view === "list"}
							onClick={() => onView("list")}
						/>
						<IconButton
							icon={RiNodeTree}
							size="s"
							label={t("sessionInsights.hotspots.tree")}
							data-testid="hotspots-view-tree"
							aria-pressed={view === "tree"}
							selected={view === "tree"}
							onClick={() => onView("tree")}
						/>
					</fieldset>
				</span>
			</div>
			{busy ? (
				<LoadingRegion
					rows={8}
					label={t("sessionInsights.stats.loading")}
					testId="stats-results-loading"
					className="p-16"
				/>
			) : hotspots.files.length === 0 ? (
				<p data-testid="hotspots-empty" className="p-16 text-center tr-text-ui text-text-muted">
					{t("sessionInsights.hotspots.empty")}
				</p>
			) : view === "tree" ? (
				<HeatTree
					result={result}
					projectNames={names}
					selected={open}
					onSelect={(file) => setOpen(fileKey(file))}
					detail={detail}
				/>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-4 px-12 py-4">
						<ToggleSegment
							testid="hotspots-filter-all"
							label={t("sessionInsights.hotspots.filterAll", { count: hotspots.files.length })}
							active={action === null}
							onClick={() => setAction(null)}
						/>
						{ACTIONS.filter((item) => item !== "none" && hotspots.actions[item] > 0).map((item) => (
							<ToggleSegment
								key={item}
								testid={`hotspots-filter-${item}`}
								label={t("sessionInsights.hotspots.filterAction", {
									action: t(ACTION_LABEL[item]),
									count: hotspots.actions[item],
								})}
								active={action === item}
								onClick={() => setAction(action === item ? null : item)}
							/>
						))}
					</div>
					<div className="min-w-0 overflow-x-auto">
						<table
							data-testid="hotspots-table"
							aria-label={t("sessionInsights.stats.section.hotspots")}
							className="w-full table-fixed border-collapse tr-text-ui"
						>
							<colgroup>
								<col className="w-40" />
								<col />
								<col className="w-72" />
								<col className="w-136" />
								<col className="w-80" />
								<col />
								<col className="w-208" />
							</colgroup>
							<thead className="bg-control-bg">
								<tr className="whitespace-nowrap tr-text-caption text-text-subtle">
									<th scope="col" className="px-8 py-2 text-right">
										{t("sessionInsights.hotspots.column.rank")}
									</th>
									<th scope="col" className="px-8 py-2 text-left">
										{t("sessionInsights.hotspots.column.file")}
									</th>
									<th scope="col" className="px-8 py-2 text-right">
										{t("sessionInsights.hotspots.column.touches")}
									</th>
									<th scope="col" className="px-8 py-2 text-left">
										{t("sessionInsights.hotspots.column.split")}
									</th>
									<th scope="col" className="px-8 py-2 text-right">
										{t("sessionInsights.hotspots.column.sessions")}
									</th>
									<th scope="col" className="px-8 py-2 text-left">
										{t("sessionInsights.hotspots.column.signal")}
									</th>
									<th scope="col" className="px-8 py-2 text-left">
										{t("sessionInsights.hotspots.column.action")}
									</th>
								</tr>
							</thead>
							<tbody>
								{files.slice(0, shown).map((file, at) => {
									const key = fileKey(file);
									return (
										<Fragment key={key}>
											<HotspotRow
												file={file}
												rank={at + 1}
												max={max}
												open={open === key}
												projectName={many ? (names.get(file.projectId ?? "") ?? null) : null}
												result={result}
												onToggle={() => setOpen(open === key ? null : key)}
											/>
											{open === key ? (
												<tr>
													<td colSpan={7} className="p-0">
														{detail(file)}
													</td>
												</tr>
											) : null}
										</Fragment>
									);
								})}
							</tbody>
						</table>
					</div>
					{files.length > shown ? (
						<div className="px-12 py-4">
							<Button variant="ghost" size="s" onClick={() => setShown(shown + PAGE)}>
								{t("sessionInsights.more", { count: Math.min(PAGE, files.length - shown) })}
							</Button>
						</div>
					) : null}
				</>
			)}
			<p data-testid="hotspots-note" className="px-12 py-8 tr-text-metadata text-text-subtle">
				{t("sessionInsights.hotspots.rules", {
					specSessions: hotspots.rules.specSessions,
					templateSessions: hotspots.rules.templateSessions,
					splitChanges: hotspots.rules.splitChanges,
					hubSessions: hotspots.rules.hubSessions,
					readShare: Math.round(hotspots.rules.readShare * 100),
					readSessions: hotspots.rules.readSessions,
					rework: hotspots.reworkChanges,
				})}{" "}
				{t("sessionInsights.hotspots.hidden", {
					outside: formatCount(locale, hotspots.outside),
					nodeModules: formatCount(locale, hotspots.nodeModules),
				})}
			</p>
		</div>
	);
}
