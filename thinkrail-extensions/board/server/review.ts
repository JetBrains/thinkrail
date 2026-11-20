import type {
	ExtensionConformanceResult,
	ExtensionPlanSummary,
	ExtensionReviewCommentInput,
} from "@thinkrail/extension-api/server";
import type { AttemptReview, RequirementSource, ReviewItem, Transition, Verdict } from "./model";
import type { DeltaRequirement } from "./openspec";
import { parseDeferrals } from "./taskSpecs";

/** The task-spec section whose bullets are the product decisions a smart review checks. */
export const PRODUCT_HEADING = "Product";
/** The author the Review shows on a smart review's comments. */
export const SMART_REVIEW_AUTHOR = "Smart review";
export const PACKET_START = "<!-- thinkrail:review-packet -->";
export const PACKET_END = "<!-- /thinkrail:review-packet -->";

/** One requirement a smart review checks, with an id stable for the same card, spec and change. */
export interface Requirement {
	id: string;
	source: RequirementSource;
	text: string;
	scenarios?: string[];
}

const slug = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "x";

/** The card's acceptance criteria, `ac-1`… in their order. */
export function criteriaRequirements(acceptance: readonly string[]): Requirement[] {
	return acceptance
		.map((text) => text.trim())
		.filter(Boolean)
		.map((text, index) => ({ id: `ac-${index + 1}`, source: "criterion", text }));
}

/** A task-spec's `## Product` bullets, `spec-<id>-1`… — each top-level bullet with its indented lines. */
export function productRequirements(specId: string, section: string): Requirement[] {
	return parseDeferrals(section).map((bullet, index) => ({
		id: `spec-${slug(specId)}-${index + 1}`,
		source: "task-spec",
		text: [bullet.title, bullet.description].filter(Boolean).join("\n"),
	}));
}

/** An OpenSpec change's delta requirements with their scenarios, `os-<capability>-<name>`. */
export function openspecRequirements(requirements: readonly DeltaRequirement[]): Requirement[] {
	const seen = new Set<string>();
	return requirements.flatMap((requirement) => {
		let id = `os-${slug(requirement.capability)}-${slug(requirement.name)}`;
		for (let n = 2; seen.has(id); n += 1)
			id = `os-${slug(requirement.capability)}-${slug(requirement.name)}-${n}`;
		seen.add(id);
		const head = `${requirement.operation} requirement "${requirement.name}" (${requirement.capability})`;
		const text =
			requirement.operation === "REMOVED"
				? `${head}: it is gone from the code, nothing still relies on it`
				: requirement.text
					? `${head}: ${requirement.text}`
					: head;
		const scenarios = (requirement.scenarios ?? []).map((scenario) =>
			`${scenario.name}\n${scenario.text}`.trim(),
		);
		return [
			{
				id,
				source: "openspec" as const,
				text,
				...(scenarios.length > 0 ? { scenarios } : {}),
			},
		];
	});
}

/** Everything a card asks for: its criteria, its task-specs' Product bullets, its change's deltas. */
export function assembleRequirements(input: {
	acceptance: readonly string[];
	products: readonly { specId: string; section: string }[];
	openspec: readonly DeltaRequirement[];
}): Requirement[] {
	return [
		...criteriaRequirements(input.acceptance),
		...input.products.flatMap(({ specId, section }) => productRequirements(specId, section)),
		...openspecRequirements(input.openspec),
	];
}

/** The reviewer's verdicts joined to the requirements they judge, in the requirements' order. */
export function reviewItems(
	requirements: readonly Requirement[],
	result: ExtensionConformanceResult,
): ReviewItem[] {
	const byId = new Map(result.items.map((item) => [item.id, item]));
	return requirements.map((requirement) => {
		const item = byId.get(requirement.id);
		return {
			...requirement,
			verdict: item?.verdict ?? "untested",
			evidence: (item?.evidence ?? []).map((entry) => ({ ...entry })),
			tests: [...(item?.tests ?? [])],
		};
	});
}

/**
 * The Review comment each unmet item becomes: on its first evidence that names a line inside the worktree;
 * an unmet item without one stays a note in the packet.
 */
export function unmetComments(
	items: readonly ReviewItem[],
): { itemId: string; comment: ExtensionReviewCommentInput }[] {
	const inWorktree = (path: string) =>
		!/^(?:[\\/]|[A-Za-z]:)/.test(path) && !path.split(/[\\/]/).includes("..");
	return items.flatMap((item) => {
		if (item.verdict !== "unmet") return [];
		const at = item.evidence.find((entry) => entry.line !== undefined && inWorktree(entry.path));
		if (!at?.line) return [];
		const note = at.note ? `\n\n${at.note}` : "";
		return [
			{
				itemId: item.id,
				comment: {
					path: at.path,
					line: at.line,
					side: "worktree" as const,
					text: `Unmet requirement: ${item.text}${note}`,
				},
			},
		];
	});
}

export interface Tally {
	met: number;
	unmet: number;
	untested: number;
	total: number;
}

export function tally(items: readonly Pick<ReviewItem, "verdict">[]): Tally {
	const count = (verdict: Verdict) => items.filter((item) => item.verdict === verdict).length;
	return {
		met: count("met"),
		unmet: count("unmet"),
		untested: count("untested"),
		total: items.length,
	};
}

/** A card's time from its log: in started (the agent working) and in review (waiting for the human). */
export function timeSplit(
	transitions: readonly Transition[],
	now: number,
): { agentMs: number; waitingMs: number } {
	let agentMs = 0;
	let waitingMs = 0;
	let open: { category: string; since: number } | null = null;
	const close = (at: number) => {
		if (!open) return;
		const span = Math.max(0, at - open.since);
		if (open.category === "started") agentMs += span;
		else waitingMs += span;
		open = null;
	};
	for (const transition of [...transitions].sort((a, b) => a.at - b.at)) {
		close(transition.at);
		const category = transition.to?.category;
		if (category === "started" || category === "review") open = { category, since: transition.at };
	}
	close(now);
	return { agentMs, waitingMs };
}

/** A card's review packet: why it exists, what was done, how it was verified, how it conforms. */
export interface Packet {
	cardId: string;
	title: string;
	why: { goal: string; initiative?: { id: string; title: string; outcome: string } };
	what: { summary: string | null; steps: { title: string; status: string; summary?: string }[] };
	verified: { title: string; verification: string }[];
	conformance: (AttemptReview & { tally: Tally }) | null;
	time: { agentMs: number; waitingMs: number };
	diff: { added: number; removed: number } | null;
	/** The packet as the PR's `## Review packet` section, without its markers. */
	markdown: string;
}

const cell = (text: string): string =>
	text
		.replace(/\|/g, "\\|")
		.replace(/\s*\n\s*/g, " ")
		.trim();

const VERDICT_MARK: Record<Verdict, string> = {
	met: "✅ met",
	unmet: "❌ unmet",
	untested: "⚠️ untested",
};

export function duration(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, "0")}m`;
}

/**
 * HTML comment delimiters in free text made inert (`&lt;!--`, `--&gt;`), so no text in the packet reads
 * as — or hides — the section's markers.
 */
export function neutralizeComments(text: string): string {
	return text.replace(/<!--/g, "&lt;!--").replace(/-->/g, "--&gt;");
}

/**
 * The packet's markdown: deterministic — the same inputs write the same bytes. The agents' free text in it
 * carries no HTML comment (`neutralizeComments`).
 */
export function renderPacket(packet: Omit<Packet, "markdown">): string {
	const lines: string[] = [
		"## Review packet",
		"",
		`**${packet.cardId} · ${cell(packet.title)}**`,
		"",
	];
	lines.push("### Why", "");
	const { initiative } = packet.why;
	if (initiative)
		lines.push(
			`- **Outcome** (${initiative.id} · ${cell(initiative.title)}): ${initiative.outcome.trim() || "—"}`,
		);
	lines.push(`- **Goal:** ${packet.why.goal.trim() || packet.title}`, "");
	lines.push("### What", "");
	if (packet.what.summary) lines.push(packet.what.summary.trim(), "");
	if (packet.what.steps.length === 0) lines.push("_No plan recorded._");
	for (const step of packet.what.steps)
		lines.push(
			`- [${step.status === "done" ? "x" : " "}] ${cell(step.title)}${step.summary ? ` — ${cell(step.summary)}` : ""}`,
		);
	lines.push("", "### How it was verified", "");
	if (packet.verified.length === 0) lines.push("_No verification recorded._");
	for (const step of packet.verified)
		lines.push(`- **${cell(step.title)}:** ${cell(step.verification)}`);
	lines.push("", "### Conformance", "");
	const review = packet.conformance;
	if (!review) lines.push("_Not reviewed yet._");
	else {
		if (review.summary.trim()) lines.push(review.summary.trim(), "");
		lines.push("| Requirement | Verdict | Evidence | Tests |", "| --- | --- | --- | --- |");
		for (const item of review.items) {
			const evidence = item.evidence
				.map(
					(entry) =>
						`\`${entry.path}${entry.line ? `:${entry.line}` : ""}\`${entry.note ? ` ${cell(entry.note)}` : ""}`,
				)
				.join("<br>");
			const tests = item.tests.map((test) => `\`${cell(test)}\``).join("<br>");
			lines.push(
				`| ${cell(item.text)} | ${VERDICT_MARK[item.verdict]} | ${evidence || "—"} | ${tests || "—"} |`,
			);
		}
		const { met, unmet, untested, total } = review.tally;
		lines.push(
			"",
			`Met ${met}/${total} · unmet ${unmet} · untested ${untested} · reviewed ${new Date(review.at).toISOString().slice(0, 10)}`,
		);
	}
	lines.push("", "### Time", "");
	const diff = packet.diff ? ` · diff +${packet.diff.added} −${packet.diff.removed}` : "";
	lines.push(
		`Agent ${duration(packet.time.agentMs)} · waiting for review ${duration(packet.time.waitingMs)}${diff}`,
		"",
		"_The smart review is advisory: it approves nothing, and a human merges._",
	);
	return neutralizeComments(lines.join("\n"));
}

export function packetOf(input: {
	card: { id: string; title: string; description: string };
	initiative?: { id: string; title: string; outcome: string };
	plan: ExtensionPlanSummary | null;
	review: AttemptReview | undefined;
	diff: { added: number; removed: number } | null;
	time: { agentMs: number; waitingMs: number };
}): Packet {
	const steps = input.plan?.steps ?? [];
	const packet: Omit<Packet, "markdown"> = {
		cardId: input.card.id,
		title: input.card.title,
		why: {
			goal: input.card.description.trim() || input.card.title,
			...(input.initiative ? { initiative: input.initiative } : {}),
		},
		what: {
			summary: input.plan?.summary ?? null,
			steps: steps.map((step) => ({
				title: step.title,
				status: step.status,
				...(step.summary ? { summary: step.summary } : {}),
			})),
		},
		verified: steps.flatMap((step) =>
			step.verification ? [{ title: step.title, verification: step.verification }] : [],
		),
		conformance: input.review ? { ...input.review, tally: tally(input.review.items) } : null,
		time: input.time,
		diff: input.diff,
	};
	return { ...packet, markdown: renderPacket(packet) };
}

/**
 * The PR description with its review packet section replaced, or appended once: only the text between
 * the markers ever changes, so upserting the same section again leaves the body as it is.
 */
export function upsertPacket(body: string, section: string): string {
	const block = `${PACKET_START}\n${section.trim()}\n${PACKET_END}`;
	const start = body.lastIndexOf(PACKET_START);
	const end = start >= 0 ? body.indexOf(PACKET_END, start) : -1;
	if (start >= 0 && end >= 0)
		return `${body.slice(0, start)}${block}${body.slice(end + PACKET_END.length)}`;
	const kept = body.trimEnd();
	return `${kept}${kept ? "\n\n" : ""}${block}\n`;
}
