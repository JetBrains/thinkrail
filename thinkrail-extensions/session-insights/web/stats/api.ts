import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	DigestProgress,
	FindingsHideParams,
	FindingsHideQuery,
	FindingsHideResult,
	FindingsListQuery,
	FindingsListResult,
	HotspotSort,
	IndexState,
	SessionsListScope,
	SliceBy,
	SlicesCompareParams,
	SlicesCompareQuery,
	SlicesCompareResult,
	StatsHotspotsParams,
	StatsHotspotsQuery,
	StatsHotspotsResult,
	StatsParams,
	StatsSequencesQuery,
	StatsSequencesResult,
	StatsUsageQuery,
	StatsUsageResult,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";
import { VersionSkew } from "../session/api";

export const STATS_USAGE: StatsUsageQuery = "stats.usage";
export const STATS_HOTSPOTS: StatsHotspotsQuery = "stats.hotspots";
export const FINDINGS_LIST: FindingsListQuery = "findings.list";
export const FINDINGS_HIDE: FindingsHideQuery = "findings.hide";
export const STATS_SEQUENCES: StatsSequencesQuery = "stats.sequences";
export const SLICES_COMPARE: SlicesCompareQuery = "slices.compare";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStats(value: unknown): value is Record<string, unknown> {
	return (
		isObject(value) &&
		value.apiVersion === API_VERSION &&
		isObject(value.state) &&
		isObject(value.digests) &&
		Array.isArray(value.sessions) &&
		isObject(value.sources)
	);
}

function isUsage(value: unknown): value is StatsUsageResult {
	return isStats(value) && isObject(value.usage) && Array.isArray(value.usage.days);
}

function isHotspots(value: unknown): value is StatsHotspotsResult {
	return isStats(value) && isObject(value.hotspots) && Array.isArray(value.hotspots.files);
}

function isSequences(value: unknown): value is StatsSequencesResult {
	return isStats(value) && isObject(value.sequences) && Array.isArray(value.sequences.cells);
}

function isCompare(value: unknown): value is SlicesCompareResult {
	return isStats(value) && isObject(value.compare) && Array.isArray(value.compare.metrics);
}

function isFindings(value: unknown): value is FindingsListResult {
	return isStats(value) && Array.isArray(value.findings) && isObject(value.rules);
}

export async function loadUsage(
	host: PanelHost,
	scope: SessionsListScope,
	signal: AbortSignal,
): Promise<StatsUsageResult> {
	const params: StatsParams = { scope };
	const value = await host.query(STATS_USAGE, params, signal);
	if (!isUsage(value)) throw new VersionSkew();
	return value;
}

export async function loadHotspots(
	host: PanelHost,
	scope: SessionsListScope,
	sort: HotspotSort,
	signal: AbortSignal,
): Promise<StatsHotspotsResult> {
	const params: StatsHotspotsParams = { scope, sort };
	const value = await host.query(STATS_HOTSPOTS, params, signal);
	if (!isHotspots(value)) throw new VersionSkew();
	return value;
}

export async function loadFindings(
	host: PanelHost,
	scope: SessionsListScope,
	signal: AbortSignal,
): Promise<FindingsListResult> {
	const params: StatsParams = { scope };
	const value = await host.query(FINDINGS_LIST, params, signal);
	if (!isFindings(value)) throw new VersionSkew();
	return value;
}

export async function loadSequences(
	host: PanelHost,
	scope: SessionsListScope,
	signal: AbortSignal,
): Promise<StatsSequencesResult> {
	const params: StatsParams = { scope };
	const value = await host.query(STATS_SEQUENCES, params, signal);
	if (!isSequences(value)) throw new VersionSkew();
	return value;
}

/** A slice definition the user picked; `null` sides let the server choose. */
export interface SliceChoice {
	by: SliceBy;
	a: string | null;
	b: string | null;
}

export async function loadCompare(
	host: PanelHost,
	scope: SessionsListScope,
	choice: SliceChoice,
	signal: AbortSignal,
): Promise<SlicesCompareResult> {
	const params: SlicesCompareParams = {
		scope,
		by: choice.by,
		...(choice.a === null ? {} : { a: choice.a }),
		...(choice.b === null ? {} : { b: choice.b }),
	};
	const value = await host.query(SLICES_COMPARE, params, signal);
	if (!isCompare(value)) throw new VersionSkew();
	return value;
}

/** Hides a finding (or shows it again); the host keeps the choice in the extension's data folder. */
export async function hideFinding(
	host: PanelHost,
	id: string,
	hidden: boolean,
	signal: AbortSignal,
): Promise<readonly string[]> {
	const params: FindingsHideParams = { id, hidden };
	const value = await host.query(FINDINGS_HIDE, params, signal);
	if (!isObject(value) || value.apiVersion !== API_VERSION || !Array.isArray(value.hidden))
		throw new VersionSkew();
	return (value as unknown as FindingsHideResult).hidden;
}

/**
 * Still building: the index is not ready or some sessions have no facts yet. Sessions only being
 * updated (`stale`, a previous revision's facts counted) do not keep the panel polling.
 */
export function stillReading(result: { state: IndexState; digests: DigestProgress }): boolean {
	return result.state.phase !== "ready" || result.digests.ready < result.digests.total;
}
