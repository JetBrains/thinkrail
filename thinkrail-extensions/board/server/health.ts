import { DAY_MS, dayOf, dayOfIso } from "./days";
import type { Forecast } from "./forecast";
import type { Category, Health } from "./model";
import type { AgentState } from "./rollups";

/** A wait for the human on the critical path older than this puts the initiative at risk. */
export const STALE_WAIT_MS = 24 * 60 * 60 * 1000;
/** Appetite used past this share warns. */
export const APPETITE_WARNING = 0.8;
/** A forecast past the target by more than this share of the span from start to target is off track. */
export const OFF_TRACK_OVERSHOOT = 0.25;

/** Why a health was suggested; the web half words each kind through a locale key. */
export type HealthReason =
	| { kind: "forecast_late"; level: Health; p85: string; target: string }
	| { kind: "blocked"; level: "at_risk"; cardIds: string[] }
	| { kind: "waiting"; level: "at_risk"; cardIds: string[] }
	| { kind: "review_wip"; level: "at_risk"; count: number; limit: number }
	| { kind: "failed"; level: "at_risk"; cardIds: string[] }
	| { kind: "appetite"; level: "at_risk"; usedPercent: number };

export interface HealthCard {
	id: string;
	category: Category;
	/** On the initiative's critical path. */
	critical: boolean;
	blocked: boolean;
	agent?: AgentState;
	/** When the agent began waiting for the human (its chat's last update). */
	waitingSince?: number;
}

export interface HealthInput {
	/** An ISO date. */
	target?: string;
	/** When the initiative began, in ms: the start of its span to the target. */
	start: number;
	forecast: Forecast;
	cards: readonly HealthCard[];
	reviewWip: { count: number; limit: number };
	appetiteDays?: number;
	timeSpentMs: number;
	override?: Health;
	note?: string;
	now: number;
}

export interface HealthView {
	suggested: Health;
	/** The human's override when set, else the suggestion. */
	effective: Health;
	override?: Health;
	note?: string;
	reasons: HealthReason[];
}

const SEVERITY: Record<Health, number> = { on_track: 0, at_risk: 1, off_track: 2 };
const ACTIVE_FOR_BLOCKED: ReadonlySet<Category> = new Set(["unstarted", "started", "review"]);
const finished = (category: Category) => category === "completed" || category === "canceled";

/**
 * The suggested health with its reasons: the 85 % forecast past the target (off track past a quarter of
 * the span more); a critical card blocked while it is wanted (Ready or later); a wait for the human older
 * than a day on the critical path; Review over its WIP limit with this initiative's cards in it; failed
 * attempts; appetite past 80 %. A human's override wins.
 */
export function suggestHealth(input: HealthInput): HealthView {
	const reasons: HealthReason[] = [];
	const { forecast, target } = input;
	if (target && forecast.status === "ok" && forecast.p85 > target) {
		const overshoot = dayOfIso(forecast.p85) - dayOfIso(target);
		const span = Math.max(0, dayOfIso(target) - Math.floor(dayOf(input.start)));
		reasons.push({
			kind: "forecast_late",
			level: overshoot > span * OFF_TRACK_OVERSHOOT ? "off_track" : "at_risk",
			p85: forecast.p85,
			target,
		});
	}
	const active = input.cards.filter((card) => !finished(card.category));
	const blocked = active.filter(
		(card) => card.critical && card.blocked && ACTIVE_FOR_BLOCKED.has(card.category),
	);
	if (blocked.length > 0)
		reasons.push({ kind: "blocked", level: "at_risk", cardIds: blocked.map((card) => card.id) });
	const waiting = active.filter(
		(card) =>
			card.critical &&
			card.agent === "waiting" &&
			card.waitingSince !== undefined &&
			input.now - card.waitingSince > STALE_WAIT_MS,
	);
	if (waiting.length > 0)
		reasons.push({ kind: "waiting", level: "at_risk", cardIds: waiting.map((card) => card.id) });
	const { count, limit } = input.reviewWip;
	if (limit > 0 && count > limit && active.some((card) => card.category === "review"))
		reasons.push({ kind: "review_wip", level: "at_risk", count, limit });
	const failed = active.filter((card) => card.agent === "failed");
	if (failed.length > 0)
		reasons.push({ kind: "failed", level: "at_risk", cardIds: failed.map((card) => card.id) });
	if (input.appetiteDays !== undefined && input.appetiteDays > 0) {
		const used = input.timeSpentMs / (input.appetiteDays * DAY_MS);
		if (used > APPETITE_WARNING)
			reasons.push({ kind: "appetite", level: "at_risk", usedPercent: Math.round(used * 100) });
	}
	const suggested = reasons.reduce<Health>(
		(worst, reason) => (SEVERITY[reason.level] > SEVERITY[worst] ? reason.level : worst),
		"on_track",
	);
	return {
		suggested,
		effective: input.override ?? suggested,
		...(input.override ? { override: input.override } : {}),
		...(input.note ? { note: input.note } : {}),
		reasons,
	};
}
