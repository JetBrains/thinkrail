import type { HealthReason } from "./health";
import { type Health, HORIZONS, type Horizon } from "./model";
import type { InitiativeNode, RoadmapView } from "./roadmap";

const HORIZON_TITLES: Record<Horizon, string> = { now: "Now", next: "Next", later: "Later" };
const HEALTH_WORDS: Record<Health, string> = {
	on_track: "On track",
	at_risk: "At risk",
	off_track: "Off track",
};

function reasonText(reason: HealthReason): string {
	switch (reason.kind) {
		case "forecast_late":
			return `85 % forecast ${reason.p85} is past the target ${reason.target}`;
		case "blocked":
			return `blocked on the critical path: ${reason.cardIds.join(", ")}`;
		case "waiting":
			return `waiting for a human over a day: ${reason.cardIds.join(", ")}`;
		case "review_wip":
			return `Review over its limit (${reason.count}/${reason.limit})`;
		case "failed":
			return `failed agent runs: ${reason.cardIds.join(", ")}`;
		case "appetite":
			return `${reason.usedPercent} % of the appetite used`;
	}
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const quoted = (text: string) =>
	text
		.trim()
		.split("\n")
		.map((line) => (line.trim() ? `> ${line.trimEnd()}` : ">"));

const byRank = (a: InitiativeNode, b: InitiativeNode) =>
	a.rank - b.rank || a.id.localeCompare(b.id, "en", { numeric: true });

function section(view: RoadmapView, initiative: InitiativeNode): string[] {
	const lines = [`### ${initiative.id} · ${oneLine(initiative.title)}`, ""];
	const parent = view.initiatives.find((candidate) => candidate.id === initiative.parentId);
	if (parent) lines.push(`Part of ${parent.id} · ${oneLine(parent.title)}.`, "");
	const outcome = initiative.outcome.trim();
	if (outcome) lines.push(outcome, "");
	const facts: string[] = [];
	const health = view.health[initiative.id];
	if (health) {
		const reasons = health.reasons.map(reasonText);
		facts.push(
			`- **Health:** ${HEALTH_WORDS[health.effective]}${health.override ? "" : " (suggested)"}${reasons.length > 0 ? ` — ${reasons.join("; ")}` : ""}`,
		);
	}
	const rollup = view.rollups.initiatives[initiative.id];
	if (rollup) {
		const counted = rollup.cards - rollup.byCategory.triage - rollup.byCategory.canceled;
		const done = rollup.byCategory.completed;
		facts.push(
			`- **Progress:** ${done}/${counted} cards${counted > 0 ? ` · ${Math.round((100 * done) / counted)} %` : ""}`,
		);
	}
	if (initiative.target) facts.push(`- **Target:** ${initiative.target}`);
	const forecast = view.forecast[initiative.id];
	if (forecast?.status === "ok")
		facts.push(`- **Forecast:** 50 % by ${forecast.p50} · 85 % by ${forecast.p85}`);
	else if (forecast?.status === "done") facts.push("- **Forecast:** nothing left to do");
	else if (forecast) facts.push("- **Forecast:** not enough data yet");
	const criteria = initiative.criteria.map(oneLine).filter(Boolean);
	if (criteria.length > 0)
		facts.push("- **Success criteria:**", ...criteria.map((item) => `  - ${item}`));
	lines.push(...facts);
	const published = initiative.updates
		.filter((update) => update.publishedAt !== undefined)
		.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))[0];
	if (published)
		lines.push(
			"",
			`**Latest update** (${HEALTH_WORDS[published.health].toLowerCase()}):`,
			"",
			...quoted(published.text),
		);
	lines.push("");
	return lines;
}

/**
 * The roadmap as a markdown file for a PR: the accepted, open initiatives by horizon (by rank), each with
 * its outcome, health, progress, target, forecast, criteria and latest published update, then the closed
 * ones. Deterministic: the same roadmap on the same day writes the same bytes — the only date of its own
 * is the generation line.
 */
export function roadmapSnapshot(view: RoadmapView, date: string): string {
	const accepted = view.initiatives.filter((initiative) => !initiative.proposed);
	const open = accepted.filter((initiative) => initiative.closedAt === undefined);
	const closed = accepted.filter((initiative) => initiative.closedAt !== undefined).sort(byRank);
	const lines = [
		`# Roadmap — ${oneLine(view.projectName)}`,
		"",
		`Generated on ${date} from the ThinkRail board. Forecasts are 50 % / 85 % ranges from the board's throughput, not commitments.`,
		"",
	];
	for (const horizon of HORIZONS) {
		lines.push(`## ${HORIZON_TITLES[horizon]}`, "");
		const listed = open.filter((initiative) => initiative.horizon === horizon).sort(byRank);
		if (listed.length === 0) lines.push("_No initiatives._", "");
		for (const initiative of listed) lines.push(...section(view, initiative));
	}
	if (closed.length > 0) {
		lines.push("## Closed", "");
		for (const initiative of closed)
			lines.push(`- ${initiative.id} · ${oneLine(initiative.title)}`);
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}
