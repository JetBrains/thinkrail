import type {
	AutopilotPause,
	Card,
	Evidence,
	Idea,
	Initiative,
	WatchEntry,
	Workflow,
} from "./model";

/** What a card's kickoff says about why it exists: its initiative and its project and milestone. */
export interface KickoffContext {
	initiative?: Pick<Initiative, "id" | "title" | "outcome" | "criteria">;
	project?: string;
	milestone?: string;
	/** The orchestrator's note for a card it starts (`board_card_start`), and who wrote it. */
	note?: { from: string; text: string };
}

/** The skill M and L cards start with, sent the way the composer sends a picked skill. */
export const BRAINSTORMING_COMMAND = "/skill:brainstorming";

/** S cards, bugs and unsized cards implement directly; M and L start with brainstorming. */
export function workflowFor(card: Pick<Card, "type" | "size">): Workflow {
	if (card.type === "bug") return "implement";
	return card.size === "M" || card.size === "L" ? "brainstorm" : "implement";
}

/** The OpenSpec skills the board's actions name, sent the way the composer sends a picked skill. */
export const OPENSPEC_SKILLS = {
	propose: "openspec-propose",
	apply: "openspec-apply-change",
	archive: "openspec-archive-change",
} as const;

function contextLines(context: KickoffContext): string[] {
	const lines: string[] = [];
	const { initiative } = context;
	if (initiative) {
		lines.push("", `Initiative ${initiative.id}: ${initiative.title.trim()}`);
		const outcome = initiative.outcome.trim();
		if (outcome) lines.push(`Outcome: ${outcome}`);
		const criteria = initiative.criteria.map((item) => item.trim()).filter(Boolean);
		if (criteria.length > 0)
			lines.push("Success criteria:", ...criteria.map((item) => `- ${item}`));
	}
	const place = [
		context.project ? `Project: ${context.project}` : "",
		context.milestone ? `Milestone: ${context.milestone}` : "",
	].filter(Boolean);
	if (place.length > 0) lines.push(...(initiative ? [] : [""]), ...place);
	const note = context.note?.text.trim();
	if (context.note && note) lines.push("", `Note from ${context.note.from}:`, note);
	return lines;
}

/**
 * An OpenSpec change's Apply: `/skill:openspec-apply-change <name>`, the card, and instructions that stand
 * alone when the workspace lacks the skill — tick each task in tasks.md as it is done, archive nothing.
 */
export function openspecApplyKickoff(
	card: Pick<Card, "id" | "title">,
	change: string,
	context: KickoffContext = {},
): string {
	return [
		`/skill:${OPENSPEC_SKILLS.apply} ${change}`,
		"",
		`Card ${card.id}: ${card.title.trim()}`,
		"",
		`Apply the OpenSpec change ${change} (openspec/changes/${change}/): read its proposal, spec deltas and design, then work through its tasks.md in order and tick each task (- [x]) as soon as it is done, so the board shows the progress. Keep the change's artifacts in step when the plan moves. Do not archive the change; that waits until I ask.`,
		...contextLines(context),
	].join("\n");
}

/** A new change from a description, proposed in a chat with `/skill:openspec-propose`. */
export function openspecProposeKickoff(description: string): string {
	return [
		`/skill:${OPENSPEC_SKILLS.propose} ${description.trim()}`,
		"",
		"Propose it as an OpenSpec change under openspec/changes/ — proposal, spec deltas, design and tasks — for me to review. Write no code yet.",
	].join("\n");
}

/** What "Archive in workspace" asks the agent of the change's apply workspace, before the PR merges. */
export function openspecArchiveMessage(change: string): string {
	return `Run ${OPENSPEC_SKILLS.archive} ${change}, then update the PR. Archive the change in this workspace (/skill:${OPENSPEC_SKILLS.archive}): its spec deltas merge into openspec/specs/ and its folder moves to openspec/changes/archive/. Commit that and push, so the pull request carries the code and the updated specs together.`;
}

/**
 * The first prompt of a card's attempt: its title, description, acceptance criteria and spec refs, then
 * its initiative's outcome and success criteria and its project and milestone; a GitHub issue's card adds
 * the issue's URL and that its PR must say `Closes #N`.
 */
export function kickoffText(
	card: Pick<Card, "id" | "title" | "description" | "acceptance" | "specRefs"> &
		Partial<Pick<Card, "source">>,
	workflow: Workflow,
	context: KickoffContext = {},
): string {
	const lines = [`Card ${card.id}: ${card.title.trim()}`];
	const description = card.description.trim();
	if (description) lines.push("", description);
	const acceptance = card.acceptance.map((item) => item.trim()).filter(Boolean);
	if (acceptance.length > 0)
		lines.push("", "Acceptance criteria:", ...acceptance.map((item) => `- ${item}`));
	const specs = card.specRefs.map((ref) => ref.trim()).filter(Boolean);
	if (specs.length > 0) lines.push("", "Specs:", ...specs.map((ref) => `- ${ref}`));
	lines.push(...contextLines(context));
	if (card.source?.kind === "github") {
		const { number, url } = card.source;
		lines.push(
			"",
			`GitHub issue #${number}${url ? `: ${url}` : ""}`,
			`The pull request's description must contain "Closes #${number}".`,
		);
	}
	const body = lines.join("\n");
	return workflow === "brainstorm" ? `${BRAINSTORMING_COMMAND} ${body}` : body;
}

export const ROADMAP_CHATS = ["plan", "shape", "report", "review", "close"] as const;
/**
 * A roadmap chat: decompose an initiative, shape it, draft its update, review the whole roadmap, or close
 * an initiative that is done.
 */
export type RoadmapChat = (typeof ROADMAP_CHATS)[number];

/** The skill each roadmap chat names; an unknown skill passes through, and the text alone instructs. */
export const ROADMAP_SKILLS: Record<RoadmapChat, string> = {
	plan: "roadmap-plan",
	shape: "roadmap-shape",
	report: "roadmap-report",
	review: "roadmap-review",
	close: "initiative-close",
};

type RoadmapInitiative = Pick<
	Initiative,
	"id" | "title" | "outcome" | "criteria" | "horizon" | "target" | "appetiteDays" | "proposed"
>;

function initiativeBlock(initiative: RoadmapInitiative): string[] {
	const lines = [`Initiative ${initiative.id}: ${initiative.title.trim()}`];
	const outcome = initiative.outcome.trim();
	lines.push(outcome ? `Outcome: ${outcome}` : "Outcome: not written yet.");
	const criteria = initiative.criteria.map((item) => item.trim()).filter(Boolean);
	if (criteria.length > 0) lines.push("Success criteria:", ...criteria.map((item) => `- ${item}`));
	const facets = [
		`horizon ${initiative.horizon}`,
		initiative.target ? `target ${initiative.target}` : "",
		initiative.appetiteDays !== undefined ? `appetite ${initiative.appetiteDays} days` : "",
	].filter(Boolean);
	lines.push(`(${facets.join(", ")})`);
	return lines;
}

type KickoffIdea = Pick<
	Idea,
	"id" | "title" | "pitch" | "evidence" | "value" | "effort" | "horizonSuggestion"
>;

/** How many pieces of an idea's evidence a prompt quotes; the rest are a tool call away. */
const EVIDENCE_QUOTED = 30;

function evidenceLine(evidence: Evidence): string {
	return `- ${evidence.id} (${evidence.kind}) ${evidence.ref}${evidence.quote ? `: "${evidence.quote}"` : ""}`;
}

/** An idea as a prompt or a tool reads it: pitch, evidence, scores with their reasons, horizon. */
export function ideaLines(idea: KickoffIdea): string[] {
	const lines = [`Idea ${idea.id}: ${idea.title.trim()}`];
	const pitch = idea.pitch.trim();
	lines.push(pitch ? `Pitch: ${pitch}` : "Pitch: not written yet.");
	if (idea.evidence.length === 0) lines.push("Evidence: none yet.");
	else {
		lines.push("Evidence:", ...idea.evidence.slice(0, EVIDENCE_QUOTED).map(evidenceLine));
		const more = idea.evidence.length - EVIDENCE_QUOTED;
		if (more > 0) lines.push(`- … and ${more} more (board_ideas_list { ideaId: "${idea.id}" })`);
	}
	for (const [label, score] of [
		["Value", idea.value],
		["Effort", idea.effort],
	] as const)
		lines.push(
			score
				? `${label}: ${score.score} of 5 (${score.suggested ? "suggested" : "set by the human"})${score.reasons.length > 0 ? ` — ${score.reasons.join("; ")}` : ""}`
				: `${label}: not scored yet.`,
		);
	if (idea.horizonSuggestion)
		lines.push(
			`Suggested horizon: ${idea.horizonSuggestion.horizon}${idea.horizonSuggestion.reason ? ` — ${idea.horizonSuggestion.reason}` : ""}`,
		);
	return lines;
}

/**
 * The first prompt of a roadmap chat: its skill as `/skill:<name>` (the way the composer sends one), the
 * task in one line, the initiative's text (or, shaping an idea, the idea's), and instructions that stand
 * alone when the skill is missing.
 */
export function roadmapKickoff(
	kind: RoadmapChat,
	context: {
		board: string;
		initiative?: RoadmapInitiative;
		/** Shape: the idea a promotion turns into an initiative. */
		idea?: KickoffIdea;
		initiatives: readonly Pick<Initiative, "id" | "title" | "horizon" | "proposed" | "closedAt">[];
	},
): string {
	const { board, initiative, idea } = context;
	const id = initiative?.id ?? "";
	const read = `board_initiative_get { initiativeId: "${id}" }`;
	const block = initiative ? initiativeBlock(initiative) : [];
	const body: string[] = [];
	if (kind === "shape" && idea)
		body.push(
			`Shape idea ${idea.id} of the ${board} board into a roadmap initiative with me.`,
			"",
			...ideaLines(idea),
			"",
			`Read the project's goal-and-requirements spec and the idea's evidence. Ask me what you need (ask_user_question), then shape the initiative: its outcome (why it matters) tied to a goal-and-requirements capability and checked against the non-goals, success criteria I can check, the risks and rabbit holes, what is out of scope and a horizon (now, next or later). Propose it with board_initiative_create_draft { title, outcome, criteria, horizon, ideaId: "${idea.id}" }, so the idea links to the initiative it became; I accept it on the board.`,
		);
	else if (kind === "plan")
		body.push(
			`Plan initiative ${id} of the ${board} board into cards.`,
			"",
			...block,
			"",
			`Read it first with ${read}: its progress, projects and cards; ground the plan in the specs (spec_search, spec_get) and the code. Break the work toward its outcome into cards, each with a title, a short description, acceptance criteria, an S / M / L size and the cards it blocks. File them in one go with board_cards_create_batch and pass a roadmap project of ${id} as roadmapProjectId — propose one with board_project_create { initiativeId: "${id}" } first when it has none — so they land in Triage as one group I accept as a whole. File only what the outcome needs, start no card, and tell me what you left out.`,
		);
	else if (kind === "shape")
		body.push(
			`Shape initiative ${id} of the ${board} board with me.`,
			"",
			...block,
			"",
			`Read it with ${read} and the project's goal-and-requirements spec. Ask me what you need (ask_user_question), then propose its outcome (why it matters), success criteria I can check, the risks and rabbit holes, what is out of scope, a horizon (now, next or later) and, if it helps, an appetite in days. Tie it to a goal-and-requirements capability and check it against the non-goals. Only propose: I edit the initiative myself.`,
		);
	else if (kind === "report")
		body.push(
			`Draft a status update of initiative ${id} of the ${board} board.`,
			"",
			...block,
			"",
			`Read its progress, health with its reasons and forecast with ${read}, and what moved with board_initiative_activity { initiativeId: "${id}", sinceDays: 7 }. Write a short update: what was done, what is stuck and why, the forecast against the target, and the health you suggest. Save it with board_update_draft { initiativeId: "${id}", text, health } (health: on_track, at_risk or off_track); I edit and publish it.`,
		);
	else if (kind === "close")
		body.push(
			`Close initiative ${id} of the ${board} board with me.`,
			"",
			...block,
			"",
			`Read it with ${read}: check each success criterion against its cards and say what is met and what is not. Propose the edit to the goal-and-requirements Capabilities (or the spec that owns the capability) as a diff in this chat; once I approve it, make the edit in this workspace and suggest I open a PR. File the deferrals its task-specs list into Triage with one board_cards_create_batch. Ask me to confirm (ask_user_question) before you mark it closed with board_initiative_close { initiativeId: "${id}" }.`,
		);
	else {
		const list = context.initiatives
			.filter((entry) => entry.closedAt === undefined)
			.map(
				(entry) =>
					`- ${entry.id} (${entry.horizon}${entry.proposed ? ", proposed" : ""}): ${entry.title.trim()}`,
			);
		body.push(
			`Review the roadmap of the ${board} board with me.`,
			"",
			...(list.length > 0 ? ["Initiatives:", ...list] : ["It has no initiatives yet."]),
			...(initiative ? ["", `Start with ${initiative.id}: ${initiative.title.trim()}.`] : []),
			"",
			"Read each initiative with board_initiative_get. From their progress, health reasons, forecasts against their targets, blocked chains, waits for me, WIP and appetite, propose a list of moves between Now, Next and Later, scope to trim and work to defer, each with the data behind it. Apply a move with board_initiative_move only after I confirm it (ask_user_question); change nothing else yourself.",
		);
	}
	return `/skill:${ROADMAP_SKILLS[kind]} ${body.join("\n")}`;
}

export const DISCOVERY_CHATS = ["research", "analyze", "watch"] as const;
/** A discovery chat: research an idea, analyze it into scores, or check what changed at the competitors. */
export type DiscoveryChat = (typeof DISCOVERY_CHATS)[number];

/** The skill each discovery chat names; the text alone instructs without it. */
export const DISCOVERY_SKILLS: Record<DiscoveryChat, string> = {
	research: "discovery-research",
	analyze: "discovery-analyze",
	watch: "competitor-watch",
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function watchLine(entry: Pick<WatchEntry, "id" | "name" | "urls" | "notes" | "snapshot">): string {
	const notes = entry.notes.replace(/\s+/g, " ").trim();
	return `- ${entry.id} ${entry.name.trim()}: ${entry.urls.join(", ") || "no URLs yet"}${notes ? ` — ${notes}` : ""} (${entry.snapshot ? `last snapshot ${isoDay(entry.snapshot.at)}` : "no snapshot yet"})`;
}

/**
 * The first prompt of a discovery chat: its skill as `/skill:<name>`, the task in one line, the idea (or the
 * watchlist), and instructions that stand alone — the report goes to this workspace's artifacts folder.
 */
export function discoveryKickoff(
	kind: DiscoveryChat,
	context: {
		board: string;
		/** Today, `YYYY-MM-DD`: the report's date. */
		today: string;
		idea?: KickoffIdea;
		entries?: readonly Pick<WatchEntry, "id" | "name" | "urls" | "notes" | "snapshot">[];
		/** The one entry "What changed?" asks about; absent, the whole watchlist. */
		watchId?: string;
	},
): string {
	const { board, today, idea } = context;
	const id = idea?.id ?? "";
	const block = idea ? ideaLines(idea) : [];
	const body: string[] = [];
	if (kind === "research") {
		const report = `.thinkrail/context/research-${id}-${today}.md`;
		body.push(
			`Research idea ${id} of the ${board} board.`,
			"",
			...block,
			"",
			`Search the web (web_search) and read the sources worth it (fetch_content): who else solves this — competitors, their features, pricing and reviews — and what users say they need. Write a report, every claim cited with its URL, into this workspace's artifacts folder: ${report}. Attach it with board_idea_add_evidence { ideaId: "${id}", kind: "artifact", ref: "${report}", quote: its main finding in one line }, and the few sources that matter most with kind "url" and the quote each backs. Score nothing: the analysis does that.`,
		);
	} else if (kind === "analyze")
		body.push(
			`Analyze idea ${id} of the ${board} board: suggest its value, effort and horizon.`,
			"",
			...block,
			"",
			`Ground it before you score: the goal-and-requirements capability it moves and whether it breaks a non-goal (spec_search, spec_get); the gap against competitors in its evidence; signals — session insights if a tool for them is available to you, and product analytics through my MCP tools if any are configured (say which you could not reach). Read the code it would touch to size the effort. Then suggest a value and an effort, each 1 to 5 with reasons citing the evidence (E-n) or the spec, and a horizon (now, next or later) with why, in one board_idea_score { ideaId: "${id}", value, effort, horizon }. A score I set stays; I decide.`,
		);
	else {
		const entries = context.entries ?? [];
		const one = context.watchId ? entries.find((entry) => entry.id === context.watchId) : undefined;
		const report = `.thinkrail/context/competitor-watch-${today}.md`;
		body.push(
			one
				? `Check what changed at ${one.name.trim()} (${one.id}), on the ${board} board's competitor watchlist.`
				: `Check what changed at the competitors on the ${board} board's watchlist.`,
			"",
			...(entries.length > 0
				? ["Watchlist:", ...(one ? [one] : entries).map(watchLine)]
				: ["The watchlist is empty."]),
			"",
			`Read the last snapshot with board_watchlist_get${one ? ` { watchId: "${one.id}" }` : ""}. Refresh each competitor from its URLs and the web (fetch_content, web_search): what it offers, pricing, recent releases and what users say. Write one dated report, every source cited, into this workspace's artifacts folder: ${report}. Then store each entry's new snapshot — plain text of what it offers now — with board_watchlist_snapshot { watchId, text, artifactPath: "${report}" }, which returns the previous one, and tell me what changed since it, entry by entry. Change no idea or initiative; offer to file a gap you find as an idea.`,
		);
	}
	return `/skill:${DISCOVERY_SKILLS[kind]} ${body.join("\n")}`;
}

/** The wake-up kinds the board sends a container's orchestrator. */
export const WAKE_RUN = "board-run";
export const WAKE_READY = "board-ready";

/** A card as the autopilot texts list it. */
export interface PilotLine {
	id: string;
	title: string;
	size?: Card["size"];
	type?: Card["type"];
}

function pilotLine(card: PilotLine): string {
	const workflow = workflowFor({
		type: card.type ?? "feature",
		...(card.size ? { size: card.size } : {}),
	});
	const size = card.size ? `size ${card.size}` : "no size";
	const design = workflow === "brainstorm" ? " (its design waits for the human's approval)" : "";
	return `- ${card.id} "${card.title.trim()}" · ${size} → ${workflow}${design}`;
}

const START_HOW =
	"Start a card with board_card_start { cardId, workflow?, note? }: it starts as a new workspace of this container on the card's kickoff, the size's workflow unless you pass one, your note appended. Only this container's initiative's ready, unblocked cards start.";

/** The `board-run` wake-up: what the container is for, what started, and how autopilot works. */
export function runBrief(input: {
	initiative: Pick<Initiative, "id" | "title" | "outcome" | "criteria">;
	boardName: string;
	started: PilotLine | null;
	autopilot: boolean;
	running: number;
	cap: number;
}): string {
	const { initiative } = input;
	const lines = [
		`This container runs initiative ${initiative.id} "${initiative.title.trim()}" of the ${input.boardName} board.`,
	];
	const outcome = initiative.outcome.trim();
	if (outcome) lines.push("", `Outcome: ${outcome}`);
	const criteria = initiative.criteria.map((item) => item.trim()).filter(Boolean);
	if (criteria.length > 0) lines.push("Success criteria:", ...criteria.map((item) => `- ${item}`));
	lines.push(
		"",
		input.started
			? `Run started ${input.started.id} "${input.started.title.trim()}" as this container's first workspace.`
			: "Run reused this container; nothing new was started.",
		`Agents running on the board: ${input.running}${input.cap > 0 ? ` of ${input.cap}` : ""}.`,
		"",
		input.autopilot
			? "Autopilot is on: the board wakes you with board-ready updates listing the cards it selected (ready, unblocked, sized, within the limits). Start them, or say in one line why you hold one back."
			: "Autopilot is off: the human starts cards from the board, or asks you to start one.",
		START_HOW,
		"Review each member's result when it settles, file follow-up work with board_card_create (it lands in Triage for the human), and merge only after the human approves in this chat.",
	);
	return lines.join("\n");
}

/**
 * The `board-ready` wake-up: every card autopilot offers now — the new ones and those offered before and
 * not started yet — with the room the limits leave. Each one replaces the last, so the latest lists them all.
 */
export function readyText(input: {
	initiative: Pick<Initiative, "id" | "title">;
	cards: readonly (PilotLine & { fresh: boolean })[];
	running: number;
	cap: number;
	retryMinutes: number;
}): string {
	const room =
		input.cap > 0
			? `${input.running} of ${input.cap} agents run on the board, so up to ${Math.max(0, input.cap - input.running)} more may start now`
			: `${input.running} agents run on the board, with no cap`;
	const lines = [
		`Autopilot of initiative ${input.initiative.id} "${input.initiative.title.trim()}": ${input.cards.length === 1 ? "this card is" : "these cards are"} ready to start (${room}):`,
		...input.cards.map(
			(card) => `${pilotLine(card)} · ${card.fresh ? "new" : "offered before, not started yet"}`,
		),
		"This list replaces every earlier board-ready update: it names all the cards autopilot offers now.",
		"",
		START_HOW,
		`A card not started within ${input.retryMinutes} minutes is offered once more, then flagged on the board as not started by you.`,
	];
	return lines.join("\n");
}

/** A pause reason in words: the limit that is past, or the missing orchestrator. */
export function pauseLine(pause: AutopilotPause): string {
	switch (pause.kind) {
		case "review":
			return `Review is over its limit (${pause.count}/${pause.limit})`;
		case "needs_you":
			return `Needs you is over its limit (${pause.count}/${pause.limit})`;
		case "orchestrator":
			return "the container has no orchestrator";
	}
}

/** The `board-ready` wake-up that withdraws the offers: autopilot is off, or paused with its reason. */
export function withdrawText(input: {
	initiative: Pick<Initiative, "id" | "title">;
	withdrawn: readonly string[];
	pause: AutopilotPause | null;
}): string {
	const name = `Autopilot of initiative ${input.initiative.id} "${input.initiative.title.trim()}"`;
	return [
		input.pause
			? `${name} is paused: ${pauseLine(input.pause)}.`
			: `${name} is off: the human switched it off.`,
		`It withdraws the cards it offered (${input.withdrawn.join(", ")}): start nothing unless the human asks you to in this chat.${input.pause ? " A new board-ready update lists the cards once it resumes." : ""}`,
		"This replaces every earlier board-ready update.",
	].join("\n");
}

/** The orchestrator's system-prompt section while its container runs an initiative, fed by the board. */
export function autopilotRule(initiatives: readonly Pick<Initiative, "id" | "title">[]): string {
	const named = initiatives.map((initiative) => `${initiative.id} "${initiative.title.trim()}"`);
	return [
		`This container runs the board initiative${named.length === 1 ? "" : "s"} ${named.join(", ")}. Updates from the Board extension (board-run, board-ready) are host automation, not the human: a board-ready update lists the cards autopilot selected to start now, the latest replacing the earlier ones, and one withdraws them while autopilot is paused or off.`,
		`- ${START_HOW} M and L cards start with brainstorming, so their design waits for the human's approval.`,
		"- File follow-ups with board_card_create (into Triage); never start cards the update did not list unless the human asks.",
	].join("\n");
}
