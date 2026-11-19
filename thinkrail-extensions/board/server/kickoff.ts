import type { Card, Initiative, Workflow } from "./model";

/** What a card's kickoff says about why it exists: its initiative and its project and milestone. */
export interface KickoffContext {
	initiative?: Pick<Initiative, "id" | "title" | "outcome" | "criteria">;
	project?: string;
	milestone?: string;
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

/**
 * The first prompt of a roadmap chat: its skill as `/skill:<name>` (the way the composer sends one), the
 * task in one line, the initiative's text, and instructions that stand alone when the skill is missing.
 */
export function roadmapKickoff(
	kind: RoadmapChat,
	context: {
		board: string;
		initiative?: RoadmapInitiative;
		initiatives: readonly Pick<Initiative, "id" | "title" | "horizon" | "proposed" | "closedAt">[];
	},
): string {
	const { board, initiative } = context;
	const id = initiative?.id ?? "";
	const read = `board_initiative_get { initiativeId: "${id}" }`;
	const block = initiative ? initiativeBlock(initiative) : [];
	const body: string[] = [];
	if (kind === "plan")
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
