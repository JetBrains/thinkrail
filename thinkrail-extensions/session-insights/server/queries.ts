import type {
	ExtensionHostServices,
	ExtensionQuery,
	ExtensionSessionView,
} from "@thinkrail/extension-api/server";
import {
	AlignmentCache,
	type BuiltTrace,
	buildContextView,
	buildDayTimeline,
	buildErrorDetail,
	buildFileDetail,
	buildFindingsList,
	buildRequestDiff,
	buildSessionAnalysis,
	buildSessionCost,
	buildSessionFiles,
	buildSessionSubagents,
	buildSessionSummary,
	buildSessionsAlign,
	buildSessionsList,
	buildSessionTimeline,
	buildSlicesCompare,
	buildStatsHotspots,
	buildStatsSequences,
	buildStatsUsage,
	buildSubagentDetail,
	type ChatAnchor,
	childTranscriptsOf,
	chromeTraceOutput,
	DAY_TIMELINE_QUERY,
	DayRowCache,
	DigestStore,
	digestInStages,
	ERROR_DETAIL_QUERY,
	type ErrorDetailResult,
	EVENT_ANCHOR_QUERY,
	EVENT_GET_QUERY,
	type EventAnchorResult,
	type EventGetResult,
	EXPORT_FIXTURE_QUERY,
	EXPORT_HTML_QUERY,
	EXPORT_RULES,
	EXPORT_TRACE_QUERY,
	type ExportKind,
	type ExportNote,
	type ExportParams,
	type ExportResult,
	exportBaseName,
	exportFailure,
	exportTitle,
	FILE_DETAIL_QUERY,
	FINDINGS_HIDE_QUERY,
	FINDINGS_LIST_QUERY,
	type FileDetailResult,
	type FindingsHideResult,
	fileSummaryCache,
	fixtureOutput,
	JsonStore,
	LABELS_GET_QUERY,
	LABELS_SET_QUERY,
	type LabelsGetResult,
	type LabelsSetResult,
	type ListProject,
	labelLookup,
	labelsView,
	listSessionFiles,
	METRIC_SOURCES,
	parseAlignParams,
	parseCompareParams,
	parseDayTimelineParams,
	parseErrorDetailParams,
	parseEventParams,
	parseExportFixtureParams,
	parseExportParams,
	parseFileDetailParams,
	parseFindingsHideParams,
	parseHotspotsParams,
	parseLabelsGetParams,
	parseLabelsSetParams,
	parseRequestDiffParams,
	parseSearchParams,
	parseSequencesParams,
	parseSessionParams,
	parseSessionsListParams,
	parseSessionsSearchParams,
	parseStatsParams,
	parseSubagentParams,
	parseTraceParams,
	REQUEST_DIFF_QUERY,
	type RequestDiffResult,
	readLabels,
	receiptForTurn,
	renderSessionHtml,
	SESSION_ANALYSIS_QUERY,
	SESSION_CONTEXT_QUERY,
	SESSION_COST_QUERY,
	SESSION_FILES_QUERY,
	SESSION_INSIGHTS_API_VERSION,
	SESSION_SUBAGENTS_QUERY,
	SESSION_SUMMARY_QUERY,
	SESSION_TIMELINE_QUERY,
	SESSION_TRACE_QUERY,
	SESSIONS_ALIGN_QUERY,
	SESSIONS_LIST_QUERY,
	SESSIONS_SEARCH_QUERY,
	SearchJobs,
	type SessionAnalysisResult,
	type SessionContextResult,
	type SessionCostResult,
	type SessionFilesResult,
	SessionIndex,
	type SessionSubagentsResult,
	type SessionsAlignResult,
	type SessionsListInput,
	type SessionsSearchResult,
	type SessionTimelineResult,
	SLICES_COMPARE_QUERY,
	STATS_HOTSPOTS_QUERY,
	STATS_SEQUENCES_QUERY,
	STATS_USAGE_QUERY,
	type StatsInput,
	SUBAGENT_GET_QUERY,
	SubagentActivityCache,
	type SubagentGetResult,
	type SubagentsInput,
	setFindingHidden,
	setSessionLabels,
	subagentJoinOf,
	TRACE_SEARCH_MAX_IDS,
	TRACE_SEARCH_QUERY,
	type TraceSearchResult,
	TraceStore,
	type TreeFile,
	tracePage,
	writeExport,
} from "@thinkrail/pi-session-insights";

const FRESH_BUDGET_MS = 150;

function listProjects(view: ExtensionSessionView): ListProject[] {
	return view.projects.map(({ id, name, kind }) => ({ id, name, kind }));
}

export function sessionInsightsQueries(
	host: ExtensionHostServices,
): Readonly<Record<string, ExtensionQuery>> {
	let index: SessionIndex | undefined;
	let traces: TraceStore | undefined;
	let dayRows: DayRowCache | undefined;
	let activity: SubagentActivityCache | undefined;
	let digests: DigestStore | undefined;
	let store: JsonStore | undefined;
	let alignments: AlignmentCache | undefined;
	let searches: SearchJobs | undefined;
	const { signal } = host;
	signal.addEventListener(
		"abort",
		() => {
			index = undefined;
			traces = undefined;
			dayRows = undefined;
			activity = undefined;
			digests = undefined;
			store = undefined;
			alignments = undefined;
			searches = undefined;
		},
		{ once: true },
	);
	const sessionIndex = () => {
		index ??= new SessionIndex({
			sessionFiles: () => listSessionFiles(host.sessionsRoot()),
			childTranscriptDirs: ({ sessionId, cwd }) => host.childTranscriptDirs(sessionId, cwd),
			cache: fileSummaryCache(host.dataDir),
			onError: (error) => host.log.warn("session index refresh failed", error),
			signal,
		});
		return index;
	};
	const traceStore = () => {
		traces ??= new TraceStore({ signal });
		return traces;
	};
	/** Each session's facts for the statistics, built once per file revision from its trace. */
	const digestStore = () => {
		digests ??= new DigestStore(
			async (summary) => {
				const trace = await traceStore().peek(summary.file);
				return trace ? digestInStages(trace, summary) : null;
			},
			(error) => host.log.warn("session digest failed", error),
			{ signal },
		);
		return digests;
	};
	const jsonStore = () => {
		store ??= new JsonStore(host.dataDir, { signal });
		return store;
	};
	const listInput = (sessions: SessionIndex, view: ExtensionSessionView): SessionsListInput => ({
		index: sessions,
		projects: listProjects(view),
		place: (cwd) => view.locate(cwd),
		status: (sessionId) => {
			const { live, completion } = host.sessionStatus(sessionId);
			return { live, outcome: completion?.outcome ?? null };
		},
	});
	/**
	 * The session the host shows in some scope: `pending` while the index has not reached it yet (it
	 * is still being built), `null` when it is not indexed or the host hides it, like the list does.
	 */
	const lookup = async (
		sessionId: string,
	): Promise<{ file: string; removed: boolean } | "pending" | null> => {
		const sessions = sessionIndex();
		const state = await sessions.ensureFresh(FRESH_BUDGET_MS);
		const summary = sessions.summaryOf(sessionId);
		if (!summary) return state.phase === "ready" ? null : "pending";
		const placement = host.sessionScope({ kind: "all" }).locate(summary.cwd);
		return placement ? { file: summary.file, removed: placement.workspace === "removed" } : null;
	};
	/** The shown session, read as not found while it is still pending (for queries asked once it was found). */
	const shownSession = async (sessionId: string) => {
		const found = await lookup(sessionId);
		return found === "pending" ? null : found;
	};
	const sessionFile = async (sessionId: string): Promise<string | null> =>
		(await shownSession(sessionId))?.file ?? null;
	/** The session's file, or one of its subagent transcripts when `childId` is given; `pending` as `lookup`. */
	const traceFile = async (sessionId: string, childId?: string) => {
		const found = await lookup(sessionId);
		if (found === "pending" || found === null) return found;
		if (childId === undefined) return found.file;
		const child = childTranscriptsOf(sessionIndex(), sessionId).get(childId)?.file;
		if (child) return child;
		return sessionIndex().state().phase === "ready" ? null : "pending";
	};
	const subagentsInput = async (sessionId: string): Promise<SubagentsInput | null> => {
		const shown = await shownSession(sessionId);
		const store = traceStore();
		const trace = shown ? await store.trace(shown.file) : null;
		if (!shown || !trace) return null;
		activity ??= new SubagentActivityCache();
		return {
			trace,
			file: shown.file,
			store,
			transcripts: childTranscriptsOf(sessionIndex(), sessionId),
			removed: shown.removed,
			activity,
		};
	};

	const list: ExtensionQuery = async (params) => {
		const { scope, fresh } = parseSessionsListParams(params);
		const sessions = sessionIndex();
		const state = await sessions.ensureFresh(FRESH_BUDGET_MS, { fresh: fresh === true });
		return buildSessionsList(listInput(sessions, host.sessionScope(scope)), state);
	};

	const summary: ExtensionQuery = async (params) => {
		const { sessionId } = parseSessionParams(params, SESSION_SUMMARY_QUERY);
		const sessions = sessionIndex();
		const state = await sessions.ensureFresh(FRESH_BUDGET_MS);
		return buildSessionSummary(
			listInput(sessions, host.sessionScope({ kind: "all" })),
			state,
			sessionId,
		);
	};

	const trace: ExtensionQuery = async (params) => {
		const parsed = parseTraceParams(params);
		const file = await traceFile(parsed.sessionId, parsed.childId);
		const at =
			file && file !== "pending" ? await traceStore().traceAt(file, parsed.revision) : null;
		return tracePage(at?.trace ?? null, parsed, {
			newerRevision: at?.newerRevision === true,
			pending: file === "pending",
		});
	};

	const event: ExtensionQuery = async (params): Promise<EventGetResult> => {
		const { sessionId, eventId, childId } = parseEventParams(params);
		const located = await traceFile(sessionId, childId);
		const file = located === "pending" ? null : located;
		const loaded = file ? await traceStore().event(file, eventId) : null;
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: loaded !== null,
			body: loaded?.body ?? null,
		};
	};

	const anchor: ExtensionQuery = async (params): Promise<EventAnchorResult> => {
		const { sessionId, eventId } = parseEventParams(params);
		const file = await sessionFile(sessionId);
		const target = file ? await traceStore().locate(file, eventId) : null;
		if (!file || !target)
			return { apiVersion: SESSION_INSIGHTS_API_VERSION, found: false, anchor: null };
		const located = await host.messageAnchor(file, target.anchorEntryId);
		let chat: ChatAnchor | null = null;
		if (located) {
			chat = { messageIndex: located.messageIndex, anchorText: located.anchorText };
			if (!located.exact) chat.approximate = true;
			const toolCallId = (located.exact ? target.toolCallId : undefined) ?? located.toolCallId;
			if (toolCallId) chat.toolCallId = toolCallId;
		}
		return { apiVersion: SESSION_INSIGHTS_API_VERSION, found: true, anchor: chat };
	};

	const timeline: ExtensionQuery = async (params): Promise<SessionTimelineResult> => {
		const { sessionId } = parseSessionParams(params, SESSION_TIMELINE_QUERY);
		const file = await sessionFile(sessionId);
		const built = file ? await traceStore().trace(file) : null;
		const join = built ? subagentJoinOf(sessionIndex(), sessionId) : null;
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: built !== null,
			timeline: built
				? await buildSessionTimeline(built, {
						contextWindow: (provider, model) => host.contextWindow(provider, model),
						outside: join?.children ?? [],
					})
				: null,
			sources: METRIC_SOURCES,
		};
	};

	const day: ExtensionQuery = async (params) => {
		const parsed = parseDayTimelineParams(params);
		const sessions = sessionIndex();
		const state = await sessions.ensureFresh(FRESH_BUDGET_MS);
		dayRows ??= new DayRowCache();
		return buildDayTimeline(
			{
				...listInput(sessions, host.sessionScope(parsed.scope)),
				rows: dayRows,
				trace: (file) => traceStore().trace(file),
			},
			state,
			parsed,
		);
	};

	const analysis: ExtensionQuery = async (params): Promise<SessionAnalysisResult> => {
		const { sessionId } = parseSessionParams(params, SESSION_ANALYSIS_QUERY);
		const file = await sessionFile(sessionId);
		const built = file ? await traceStore().trace(file) : null;
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: built !== null,
			analysis: built
				? buildSessionAnalysis(built, [...childTranscriptsOf(sessionIndex(), sessionId).keys()])
				: null,
			sources: METRIC_SOURCES,
		};
	};

	const errorDetail: ExtensionQuery = async (params): Promise<ErrorDetailResult> => {
		const { sessionId, chain } = parseErrorDetailParams(params);
		const file = await sessionFile(sessionId);
		const store = traceStore();
		const built = file ? await store.trace(file) : null;
		const detail = file && built ? await buildErrorDetail(store, file, built, chain) : null;
		return { apiVersion: SESSION_INSIGHTS_API_VERSION, found: detail !== null, detail };
	};

	const subagents: ExtensionQuery = async (params): Promise<SessionSubagentsResult> => {
		const { sessionId } = parseSessionParams(params, SESSION_SUBAGENTS_QUERY);
		const input = await subagentsInput(sessionId);
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: input !== null,
			subagents: input ? await buildSessionSubagents(input) : null,
			sources: METRIC_SOURCES,
		};
	};

	const subagent: ExtensionQuery = async (params): Promise<SubagentGetResult> => {
		const { sessionId, childId } = parseSubagentParams(params);
		const input = await subagentsInput(sessionId);
		const detail = input ? await buildSubagentDetail(input, childId) : null;
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: detail !== null,
			detail,
			sources: METRIC_SOURCES,
		};
	};

	const sessionTrace = async (sessionId: string) => {
		const shown = await shownSession(sessionId);
		const store = traceStore();
		const trace = shown ? await store.trace(shown.file) : null;
		return shown && trace ? { ...shown, store, trace } : null;
	};
	const contextWindow = (provider: string, model: string) => host.contextWindow(provider, model);
	/** The host's run receipts, only for a session in an open workspace (paths are that worktree's). */
	const receipts = async (sessionId: string, removed: boolean) =>
		removed ? [] : await host.turnReceipts(sessionId);

	const context: ExtensionQuery = async (params): Promise<SessionContextResult> => {
		const { sessionId } = parseSessionParams(params, SESSION_CONTEXT_QUERY);
		const loaded = await sessionTrace(sessionId);
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: loaded !== null,
			context: loaded ? await buildContextView(loaded.trace, { contextWindow }) : null,
			sources: METRIC_SOURCES,
		};
	};

	const requestDiff: ExtensionQuery = async (params): Promise<RequestDiffResult> => {
		const { sessionId, callId } = parseRequestDiffParams(params);
		const loaded = await sessionTrace(sessionId);
		const diff = loaded
			? await buildRequestDiff(loaded.store, loaded.file, loaded.trace, callId)
			: null;
		return { apiVersion: SESSION_INSIGHTS_API_VERSION, found: diff !== null, diff };
	};

	const cost: ExtensionQuery = async (params): Promise<SessionCostResult> => {
		const { sessionId } = parseSessionParams(params, SESSION_COST_QUERY);
		const loaded = await sessionTrace(sessionId);
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: loaded !== null,
			cost: loaded ? await buildSessionCost(loaded.trace, { contextWindow }) : null,
			sources: METRIC_SOURCES,
		};
	};

	const files: ExtensionQuery = async (params): Promise<SessionFilesResult> => {
		const { sessionId } = parseSessionParams(params, SESSION_FILES_QUERY);
		const loaded = await sessionTrace(sessionId);
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: loaded !== null,
			files: loaded
				? buildSessionFiles(loaded.trace, await receipts(sessionId, loaded.removed))
				: null,
			sources: METRIC_SOURCES,
		};
	};

	const fileDetail: ExtensionQuery = async (params): Promise<FileDetailResult> => {
		const { sessionId, path } = parseFileDetailParams(params);
		const loaded = await sessionTrace(sessionId);
		const detail = loaded
			? await buildFileDetail(
					loaded.store,
					loaded.file,
					loaded.trace,
					path,
					await receipts(sessionId, loaded.removed),
				)
			: null;
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: detail !== null,
			detail,
			sources: METRIC_SOURCES,
		};
	};

	const statsInput = async (value: unknown, method: string, withLabels = false) => {
		const { scope } = parseStatsParams(value, method);
		const sessions = sessionIndex();
		const state = await sessions.ensureFresh(FRESH_BUDGET_MS);
		const input: StatsInput = {
			...listInput(sessions, host.sessionScope(scope)),
			digests: digestStore(),
			contextWindow,
			...(withLabels ? { labelsOf: labelLookup(await readLabels(jsonStore())) } : {}),
		};
		return { input, state };
	};

	const searchAcross: ExtensionQuery = async (params): Promise<SessionsSearchResult> => {
		const parsed = parseSessionsSearchParams(params);
		const { input, state } = await statsInput(params, SESSIONS_SEARCH_QUERY, true);
		searches ??= new SearchJobs({ redactor: traceStore().redaction, signal });
		return searches.run(input, state, parsed);
	};

	const usage: ExtensionQuery = async (params) => {
		const { input, state } = await statsInput(params, STATS_USAGE_QUERY);
		return buildStatsUsage(input, state);
	};

	const hotspots: ExtensionQuery = async (params) => {
		const parsed = parseHotspotsParams(params);
		const { input, state } = await statsInput(params, STATS_HOTSPOTS_QUERY);
		return buildStatsHotspots(input, state, parsed);
	};

	const findings: ExtensionQuery = async (params) => {
		const { input, state } = await statsInput(params, FINDINGS_LIST_QUERY);
		return buildFindingsList(
			{ ...input, store: jsonStore(), redactor: traceStore().redaction },
			state,
		);
	};

	const sequences: ExtensionQuery = async (params) => {
		parseSequencesParams(params);
		const { input, state } = await statsInput(params, STATS_SEQUENCES_QUERY);
		return buildStatsSequences(input, state);
	};

	const compare: ExtensionQuery = async (params) => {
		const parsed = parseCompareParams(params);
		const { input, state } = await statsInput(params, SLICES_COMPARE_QUERY, true);
		return buildSlicesCompare(input, state, parsed);
	};

	const align: ExtensionQuery = async (params): Promise<SessionsAlignResult> => {
		const { a, b, cursor, revisions } = parseAlignParams(params);
		const side = async (sessionId: string, revision?: string) => {
			const found = await lookup(sessionId);
			if (found === "pending" || found === null) return found;
			const at = await traceStore().traceAt(found.file, revision);
			return at ? { sessionId, ...at } : null;
		};
		alignments ??= new AlignmentCache();
		const sides = [await side(a, revisions?.a), await side(b, revisions?.b)];
		const [left, right] = sides.map((found) => (found === "pending" ? null : found));
		return buildSessionsAlign(
			alignments,
			left ?? null,
			right ?? null,
			cursor ?? 0,
			sides.includes("pending") && !sides.includes(null),
		);
	};

	const hideFinding: ExtensionQuery = async (params): Promise<FindingsHideResult> => {
		const parsed = parseFindingsHideParams(params);
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			hidden: await setFindingHidden(jsonStore(), parsed),
		};
	};

	const getLabels: ExtensionQuery = async (params): Promise<LabelsGetResult> => {
		const parsed = parseLabelsGetParams(params);
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			...labelsView(await readLabels(jsonStore()), parsed),
		};
	};

	const setLabels: ExtensionQuery = async (params): Promise<LabelsSetResult> => {
		const parsed = parseLabelsSetParams(params);
		const written = await setSessionLabels(jsonStore(), parsed);
		return written.ok
			? { apiVersion: SESSION_INSIGHTS_API_VERSION, ...written }
			: { apiVersion: SESSION_INSIGHTS_API_VERSION, ok: false, code: "LABELS_FULL" };
	};

	/**
	 * What every export starts from: the shown session, the workspace's artifacts folder and the name.
	 * Each export step checks the table's signal after it awaits, so a switch-off rejects with its reason.
	 */
	const exportStart = async (kind: ExportKind, params: ExportParams) => {
		const loaded = await sessionTrace(params.sessionId);
		signal.throwIfAborted();
		const sessions = sessionIndex();
		const overview = loaded
			? (
					await buildSessionSummary(
						listInput(sessions, host.sessionScope({ kind: "all" })),
						await sessions.ensureFresh(FRESH_BUDGET_MS),
						params.sessionId,
					)
				).session
			: null;
		signal.throwIfAborted();
		if (!loaded || !overview)
			return { ok: false as const, failure: exportFailure(kind, "SESSION_NOT_FOUND") };
		const target = await host.ensureArtifactsDir(params.workspaceId);
		signal.throwIfAborted();
		if (!target) return { ok: false as const, failure: exportFailure(kind, "NO_ARTIFACTS_DIR") };
		const stored = params.includeLabels
			? (await readLabels(jsonStore())).sessions.get(params.sessionId)
			: undefined;
		signal.throwIfAborted();
		const labels = params.includeLabels
			? { labels: stored?.labels ?? [], note: stored?.note ?? null }
			: null;
		const redactor = loaded.store.redaction;
		const title = exportTitle(overview, redactor);
		return {
			ok: true as const,
			loaded,
			overview,
			target,
			labels,
			redactor,
			title,
			base: exportBaseName(loaded.trace, title),
			notes: (labels ? ["labels"] : []) as ExportNote[],
		};
	};

	const exportHtml: ExtensionQuery = async (params): Promise<ExportResult> => {
		const parsed = parseExportParams(params, EXPORT_HTML_QUERY);
		const start = await exportStart("html", parsed);
		if (!start.ok) return start.failure;
		const { loaded } = start;
		const join = subagentJoinOf(sessionIndex(), parsed.sessionId);
		const input = await subagentsInput(parsed.sessionId);
		signal.throwIfAborted();
		const timeline = await buildSessionTimeline(loaded.trace, {
			contextWindow,
			outside: join?.children ?? [],
		});
		signal.throwIfAborted();
		const subagents = input ? await buildSessionSubagents(input) : null;
		signal.throwIfAborted();
		const html = await renderSessionHtml({
			overview: start.overview,
			trace: loaded.trace,
			store: loaded.store,
			timeline,
			analysis: buildSessionAnalysis(loaded.trace, [
				...childTranscriptsOf(sessionIndex(), parsed.sessionId).keys(),
			]),
			subagents,
			labels: start.labels,
			signal,
		});
		return writeExport(
			start.target,
			{
				kind: "html",
				name: `${start.base}.html`,
				folder: false,
				files: [{ path: "", content: html, check: "html" }],
				notes: start.notes,
				sources: [loaded.trace.file],
			},
			{ signal },
		);
	};

	const exportTrace: ExtensionQuery = async (params): Promise<ExportResult> => {
		const parsed = parseExportParams(params, EXPORT_TRACE_QUERY);
		const start = await exportStart("trace", parsed);
		if (!start.ok) return start.failure;
		const { trace } = start.loaded;
		const children = new Map<string, BuiltTrace>();
		for (const [childId, transcript] of childTranscriptsOf(sessionIndex(), parsed.sessionId)) {
			const child = await start.loaded.store.peek(transcript.file);
			signal.throwIfAborted();
			if (child) children.set(childId, child);
		}
		const notes = [...start.notes];
		if (trace.events.some((event) => event.kind === "subagent" && !children.has(event.childId)))
			notes.push("childrenMissing");
		return writeExport(
			start.target,
			chromeTraceOutput(
				{
					trace,
					title: start.title,
					children,
					base: start.base,
					...(start.labels
						? {
								otherData: {
									labels: start.labels.labels.map((label) => start.redactor.redact(label)),
									note: start.labels.note === null ? null : start.redactor.clean(start.labels.note),
								},
							}
						: {}),
				},
				notes,
			),
			{ signal },
		);
	};

	const exportFixture: ExtensionQuery = async (params): Promise<ExportResult> => {
		const parsed = parseExportFixtureParams(params, EXPORT_FIXTURE_QUERY);
		const start = await exportStart("fixture", parsed);
		if (!start.ok) return start.failure;
		const { loaded } = start;
		const last = loaded.trace.events.findLast((event) => event.kind === "turn");
		const cut =
			parsed.cut ?? (last?.kind === "turn" ? { kind: "turn" as const, turn: last.n } : null);
		const output = cut
			? await fixtureOutput({
					trace: loaded.trace,
					cut,
					redactor: start.redactor,
					base: start.base,
					...(parsed.name ? { name: parsed.name } : {}),
					labels: start.labels,
					snapshot: async (span): Promise<readonly TreeFile[] | "tooLarge" | null> => {
						const receipt = receiptForTurn(await receipts(parsed.sessionId, loaded.removed), span);
						signal.throwIfAborted();
						if (!receipt) return null;
						const tree = await host.turnTree(
							parsed.sessionId,
							receipt.startedAt,
							EXPORT_RULES.snapshot,
						);
						if (!tree) return null;
						return tree.kind === "tooLarge" ? "tooLarge" : tree.files;
					},
					signal,
				})
			: null;
		if (!output) return exportFailure("fixture", "CUT_NOT_FOUND", cut ? cut.kind : "noTurns");
		return writeExport(start.target, output, { signal });
	};

	const search: ExtensionQuery = async (params): Promise<TraceSearchResult> => {
		const { sessionId, query } = parseSearchParams(params);
		const file = await sessionFile(sessionId);
		const found = file ? await traceStore().search(file, query, TRACE_SEARCH_MAX_IDS) : null;
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: found !== null,
			revision: found?.trace.meta.revision ?? null,
			ids: found?.ids ?? [],
			truncated: found?.truncated ?? false,
		};
	};

	return {
		[SESSIONS_LIST_QUERY]: list,
		[SESSION_SUMMARY_QUERY]: summary,
		[SESSION_TRACE_QUERY]: trace,
		[EVENT_GET_QUERY]: event,
		[EVENT_ANCHOR_QUERY]: anchor,
		[TRACE_SEARCH_QUERY]: search,
		[SESSION_TIMELINE_QUERY]: timeline,
		[DAY_TIMELINE_QUERY]: day,
		[SESSION_ANALYSIS_QUERY]: analysis,
		[ERROR_DETAIL_QUERY]: errorDetail,
		[SESSION_SUBAGENTS_QUERY]: subagents,
		[SUBAGENT_GET_QUERY]: subagent,
		[SESSION_CONTEXT_QUERY]: context,
		[REQUEST_DIFF_QUERY]: requestDiff,
		[SESSION_COST_QUERY]: cost,
		[SESSION_FILES_QUERY]: files,
		[FILE_DETAIL_QUERY]: fileDetail,
		[STATS_USAGE_QUERY]: usage,
		[STATS_HOTSPOTS_QUERY]: hotspots,
		[FINDINGS_LIST_QUERY]: findings,
		[FINDINGS_HIDE_QUERY]: hideFinding,
		[STATS_SEQUENCES_QUERY]: sequences,
		[SLICES_COMPARE_QUERY]: compare,
		[SESSIONS_ALIGN_QUERY]: align,
		[SESSIONS_SEARCH_QUERY]: searchAcross,
		[LABELS_GET_QUERY]: getLabels,
		[LABELS_SET_QUERY]: setLabels,
		[EXPORT_HTML_QUERY]: exportHtml,
		[EXPORT_TRACE_QUERY]: exportTrace,
		[EXPORT_FIXTURE_QUERY]: exportFixture,
	};
}
