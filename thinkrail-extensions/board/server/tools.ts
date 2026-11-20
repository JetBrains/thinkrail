import { isAbsolute, relative } from "node:path";
import type { ExtensionAPI, ExtensionFactory, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Activity } from "./activity";
import type { Board, CardDeferrals } from "./board";
import { isIsoDate } from "./days";
import type { IdeaView } from "./discovery";
import { ideaLines } from "./kickoff";
import {
	CARD_SIZES,
	CARD_TYPES,
	CATEGORIES,
	type Card,
	EVIDENCE_KINDS,
	HEALTHS,
	HORIZONS,
	IDEA_STATUSES,
	type Initiative,
	SCORE_MAX,
	SCORE_MIN,
	type WatchEntry,
	WORKFLOWS,
} from "./model";
import type { RoadmapView } from "./roadmap";

const literals = <T extends string>(values: readonly T[], description: string) =>
	Type.Union(
		values.map((value) => Type.Literal(value)),
		{ description },
	);

const GetParams = Type.Object({
	cardId: Type.Optional(
		Type.String({
			description: "A card id such as TR-12. Omit it for the card this chat works on.",
		}),
	),
});

const ListParams = Type.Object({
	status: Type.Optional(
		literals(CATEGORIES, "Only cards in this status (category). Omit for every card."),
	),
});

const CreateParams = Type.Object({
	title: Type.String({ description: "One line: the outcome the card asks for." }),
	description: Type.Optional(Type.String({ description: "Why and what, in a few sentences." })),
	acceptance: Type.Optional(
		Type.Array(Type.String(), { description: "Acceptance criteria, one per item." }),
	),
	type: Type.Optional(literals(CARD_TYPES, "feature (default), bug or chore.")),
	size: Type.Optional(
		literals(CARD_SIZES, "Your size estimate: S (one sitting), M or L (needs design first)."),
	),
});

const LinkParams = Type.Object({
	cardId: Type.String({ description: "The card that blocks the others." }),
	blocks: Type.Array(Type.String(), {
		description: "Ids of the cards it blocks (they cannot start before it is done).",
	}),
});

const StartParams = Type.Object({
	cardId: Type.String({
		description: "The card to start, such as TR-12: one of the initiative this container runs.",
	}),
	workflow: Type.Optional(
		literals(
			WORKFLOWS,
			"implement or brainstorm; by default the size's (S and bugs implement, M and L brainstorm first).",
		),
	),
	note: Type.Optional(
		Type.String({
			description:
				"Context for the card's agent, appended to its kickoff: what to watch for, which sibling to build on.",
		}),
	),
});

/** The orchestrator's system-prompt section while its container runs an initiative. */
export const AUTOPILOT_SECTION = "thinkrail-board-autopilot";

/**
 * Whether the chat's current turn answers the human: the latest messages it acts on (those after its last
 * reply) include one the human wrote, not only host updates such as a `board-ready` wake-up.
 */
export function answersHuman(branch: readonly SessionEntry[]): boolean {
	let prompted = false;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "custom_message") prompted = true;
		else if (entry?.type === "message") {
			const { role } = entry.message;
			if (role === "user") return true;
			if (role === "assistant" && prompted) return false;
		}
	}
	return false;
}

const NoteParams = Type.Object({
	text: Type.String({ description: "A short progress note for the human, in one or two lines." }),
});

const InitiativeGetParams = Type.Object({
	initiativeId: Type.Optional(
		Type.String({
			description:
				"An initiative id such as I-3. Omit it for the initiative of the card this chat works on.",
		}),
	),
});

const InitiativeDraftParams = Type.Object({
	title: Type.String({ description: "One line: the initiative's name." }),
	outcome: Type.String({ description: "Why: the outcome it is for, in a few sentences." }),
	criteria: Type.Optional(
		Type.Array(Type.String(), { description: "Success criteria, one per item." }),
	),
	horizon: Type.Optional(literals(HORIZONS, "now, next or later (default).")),
	ideaId: Type.Optional(
		Type.String({
			description:
				"The discovery idea (D-n) this initiative is shaped from; the idea is then marked promoted and linked to it.",
		}),
	),
});

const IdeasListParams = Type.Object({
	ideaId: Type.Optional(
		Type.String({
			description:
				"An idea id such as D-3: read it whole (pitch, evidence, scores with reasons). Omit to list every idea.",
		}),
	),
	status: Type.Optional(literals(IDEA_STATUSES, "Only ideas in this status.")),
});

const IdeaCreateParams = Type.Object({
	title: Type.String({ description: "One line: the idea." }),
	pitch: Type.String({
		description: "Who it is for, the problem and the bet, in a few sentences.",
	}),
});

const EvidenceParams = Type.Object({
	ideaId: Type.String({ description: "The idea (D-n) the evidence backs." }),
	kind: literals(
		EVIDENCE_KINDS,
		"artifact (a report you wrote into this workspace's .thinkrail/context/), url (a source on the web) or note.",
	),
	ref: Type.String({
		description:
			"artifact: its path relative to this workspace (.thinkrail/context/…); url: the http(s) URL; note: the text.",
	}),
	quote: Type.Optional(
		Type.String({ description: "What it says that matters for the idea, quoted or in one line." }),
	),
});

const score = (what: string) =>
	Type.Object(
		{
			score: Type.Integer({
				minimum: SCORE_MIN,
				maximum: SCORE_MAX,
				description: `${what}, from ${SCORE_MIN} (low) to ${SCORE_MAX} (high).`,
			}),
			reasons: Type.Array(Type.String(), {
				minItems: 1,
				description: "Why, one reason per item, citing the evidence (E-n) or the spec behind it.",
			}),
		},
		{ description: `The suggested ${what.toLowerCase()} with its reasons.` },
	);

const ScoreParams = Type.Object({
	ideaId: Type.String({ description: "The idea (D-n) you analyzed." }),
	value: Type.Optional(score("Value")),
	effort: Type.Optional(score("Effort")),
	horizon: Type.Optional(
		Type.Object(
			{
				horizon: literals(HORIZONS, "now, next or later."),
				reason: Type.String({ description: "Why that horizon, in one line." }),
			},
			{ description: "The horizon you suggest for it." },
		),
	),
});

const WatchGetParams = Type.Object({
	watchId: Type.Optional(
		Type.String({ description: "A watchlist entry such as W-2. Omit for the whole watchlist." }),
	),
});

const SnapshotParams = Type.Object({
	watchId: Type.String({ description: "The watchlist entry (W-n) you refreshed." }),
	text: Type.String({
		description:
			"The new snapshot: plain text of what the competitor offers now (features, pricing, recent releases), stable enough to diff against the next one.",
	}),
	artifactPath: Type.Optional(
		Type.String({
			description: "The dated report you wrote, relative to this workspace (.thinkrail/context/…).",
		}),
	),
});

const ProjectCreateParams = Type.Object({
	initiativeId: Type.String({ description: "The initiative (I-n) the project serves." }),
	title: Type.String({ description: "One line: the project's name." }),
	milestones: Type.Optional(
		Type.Array(
			Type.Object({
				title: Type.String({ description: "The milestone's name." }),
				target: Type.Optional(Type.String({ description: "Its target date, YYYY-MM-DD." })),
			}),
			{ description: "The project's milestones, in order." },
		),
	),
});

const BatchParams = Type.Object({
	roadmapProjectId: Type.Optional(
		Type.String({ description: "A roadmap project (P-n) of this board the cards join." }),
	),
	cards: Type.Array(
		Type.Object({
			title: Type.String({ description: "One line: the outcome the card asks for." }),
			description: Type.Optional(Type.String({ description: "Why and what, in a few sentences." })),
			acceptance: Type.Optional(
				Type.Array(Type.String(), { description: "Acceptance criteria, one per item." }),
			),
			type: Type.Optional(literals(CARD_TYPES, "feature (default), bug or chore.")),
			size: Type.Optional(literals(CARD_SIZES, "Your size estimate: S, M or L.")),
			blocksIndex: Type.Optional(
				Type.Array(Type.Integer(), {
					description: "Positions (0-based) in this batch of the cards this one blocks.",
				}),
			),
		}),
		{ description: "The cards of the decomposition, in order.", minItems: 1, maxItems: 50 },
	),
});

const ActivityParams = Type.Object({
	initiativeId: Type.String({ description: "The initiative (I-n) whose cards' activity to read." }),
	sinceDays: Type.Optional(
		Type.Integer({
			description: "How many days back to read (default 7).",
			minimum: 1,
			maximum: 365,
		}),
	),
});

const MoveParams = Type.Object({
	initiativeId: Type.String({ description: "The initiative (I-n) to move." }),
	horizon: literals(HORIZONS, "The horizon it moves to: now, next or later."),
});

const CloseParams = Type.Object({
	initiativeId: Type.String({ description: "The initiative (I-n) the human confirmed done." }),
});

const UpdateDraftParams = Type.Object({
	initiativeId: Type.String({ description: "The initiative (I-n) the update reports on." }),
	text: Type.String({
		description: "The update: what was done, what is stuck and why, the forecast. Markdown.",
	}),
	health: literals(HEALTHS, "The health you suggest: on_track, at_risk or off_track."),
});

function describe(card: Card): string {
	const facets = [
		card.type,
		card.size ? `size ${card.size}${card.sizeSuggested ? " (suggested)" : ""}` : "",
	]
		.filter(Boolean)
		.join(", ");
	const lines = [
		`${card.id} · ${card.title} (${facets}) · ${card.category}, column ${card.column}`,
	];
	if (card.source.kind === "github")
		lines.push(
			`GitHub issue #${card.source.number}: ${card.source.url} (its PR must say "Closes #${card.source.number}")`,
		);
	if (card.source.kind === "task-spec")
		lines.push(`Task-spec ${card.source.ref} at ${card.source.path}`);
	if (card.description) lines.push("", card.description);
	if (card.acceptance.length > 0)
		lines.push("", "Acceptance criteria:", ...card.acceptance.map((item) => `- ${item}`));
	if (card.specRefs.length > 0) lines.push("", `Specs: ${card.specRefs.join(", ")}`);
	if (card.blocks.length > 0) lines.push(`Blocks: ${card.blocks.join(", ")}`);
	const notes = card.attempts.flatMap((attempt) => attempt.notes);
	if (notes.length > 0) lines.push("", "Progress notes:", ...notes.map((note) => `- ${note.text}`));
	return lines.join("\n");
}

const summary = (card: Card): string =>
	`${card.id} [${card.category}] ${card.title}${card.size ? ` (${card.size})` : ""}`;

function result(text: string, card?: Card) {
	return { content: [{ type: "text" as const, text }], details: card ? { card } : {} };
}

function reply<T extends object>(text: string, details: T) {
	return { content: [{ type: "text" as const, text }], details };
}

/** An initiative as the agent reads it: its text, health, forecast, rollup, projects and cards. */
function describeInitiative(view: RoadmapView, initiative: Initiative): string {
	const facets = [
		`horizon ${initiative.horizon}`,
		initiative.target ? `target ${initiative.target}` : "",
		initiative.appetiteDays !== undefined ? `appetite ${initiative.appetiteDays} days` : "",
		initiative.proposed ? "proposed, not accepted yet" : "",
		initiative.closedAt !== undefined ? `closed ${isoDay(initiative.closedAt)}` : "",
	].filter(Boolean);
	const lines = [`${initiative.id} · ${initiative.title} (${facets.join(", ")})`];
	if (initiative.outcome) lines.push("", `Outcome: ${initiative.outcome}`);
	if (initiative.criteria.length > 0)
		lines.push("", "Success criteria:", ...initiative.criteria.map((item) => `- ${item}`));
	const health = view.health[initiative.id];
	if (health) {
		const reasons = health.reasons.map((reason) => reason.kind).join(", ");
		lines.push(
			"",
			`Health: ${health.effective}${health.override ? " (set by the human)" : ` (suggested${reasons ? `: ${reasons}` : ""})`}`,
		);
	}
	const forecast = view.forecast[initiative.id];
	if (forecast?.status === "ok")
		lines.push(`Forecast: 50 % by ${forecast.p50}, 85 % by ${forecast.p85}`);
	else if (forecast?.status === "done") lines.push("Forecast: nothing left to do");
	else if (forecast) lines.push(`Forecast: not enough data (${forecast.reason})`);
	const counted = view.rollups.initiatives[initiative.id];
	if (counted)
		lines.push(
			`Progress: ${counted.byCategory.completed} of ${counted.cards} cards done, ${counted.points.completed}/${counted.points.total} points; agents working ${counted.agents.working}, waiting ${counted.agents.waiting}, failed ${counted.agents.failed}; blocked ${counted.blocked}`,
		);
	const projects = view.projects.filter((project) => project.initiativeId === initiative.id);
	if (projects.length > 0)
		lines.push(
			"",
			"Projects:",
			...projects.map((project) => {
				const milestones = project.milestones
					.map(
						(milestone) =>
							`${milestone.id} ${milestone.title}${milestone.target ? ` by ${milestone.target}` : ""}`,
					)
					.join("; ");
				return `- ${project.id} ${project.title}${milestones ? ` (milestones: ${milestones})` : ""}`;
			}),
		);
	const node = view.initiatives.find((candidate) => candidate.id === initiative.id);
	const cards = node?.memberCardIds ?? [];
	const external = view.externalCards.filter((card) =>
		node?.memberExternalCards.some((ref) => ref.cardId === card.cardId),
	);
	if (cards.length + external.length > 0)
		lines.push(
			"",
			`Cards: ${[...cards, ...external.map((card) => `${card.cardId} (${card.projectName ?? card.projectId})`)].join(", ")}`,
		);
	if (initiative.specRefs.length > 0) lines.push(`Specs: ${initiative.specRefs.join(", ")}`);
	return lines.join("\n");
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function describeDeferrals(found: readonly CardDeferrals[]): string {
	if (found.length === 0) return "";
	return [
		"",
		"Deferrals its cards' task-specs list (not on the board yet):",
		...found.flatMap(({ cardId, specId, deferrals }) =>
			deferrals.map(
				(deferral) =>
					`- ${deferral.title} (from ${specId} of ${cardId})${deferral.description ? ` — ${deferral.description.replace(/\s+/g, " ").trim()}` : ""}`,
			),
		),
	].join("\n");
}

/** An initiative's activity as the agent reads it: what reached each state, the moves, notes and quiet cards. */
function describeActivity(
	initiative: Initiative,
	activity: Activity,
	titles: Record<string, string>,
	days: number,
): string {
	const named = (id: string) => `${id} ${titles[id] ?? ""}`.trim();
	const lines = [
		`Activity of ${initiative.id} · ${initiative.title} over the last ${days} days (${isoDay(activity.since)} to ${isoDay(activity.until)}):`,
	];
	for (const [label, ids] of [
		["Completed", activity.completed],
		["Started", activity.started],
		["Into review", activity.review],
		["Filed", activity.filed],
		["Canceled", activity.canceled],
	] as const)
		if (ids.length > 0) lines.push(`${label} (${ids.length}): ${ids.map(named).join("; ")}`);
	if (activity.moves.length === 0) lines.push("No card moved.");
	else
		lines.push(
			"",
			"Moves:",
			...activity.moves.map(
				(move) =>
					`- ${isoDay(move.at)} ${move.cardId}: ${move.from ?? "new"} → ${move.to ?? "deleted"} (${move.actor}${move.reason ? `: ${move.reason}` : ""})`,
			),
		);
	if (activity.notes.length > 0)
		lines.push(
			"",
			"Progress notes:",
			...activity.notes.map((note) => `- ${isoDay(note.at)} ${note.cardId}: ${note.text}`),
		);
	if (activity.still.length > 0)
		lines.push(
			"",
			"Did not move:",
			...activity.still.map(
				(card) =>
					`- ${named(card.cardId)} (${card.category}${card.since !== null ? ` since ${isoDay(card.since)}` : ""})`,
			),
		);
	return lines.join("\n");
}

function scoreText(idea: Pick<IdeaView, "value" | "effort">): string {
	return (["value", "effort"] as const)
		.flatMap((key) => {
			const entry = idea[key];
			return entry ? [`${key} ${entry.score}${entry.suggested ? " (suggested)" : ""}`] : [];
		})
		.join(", ");
}

function ideaSummary(idea: IdeaView): string {
	const facets = [
		scoreText(idea) || "not scored",
		`${idea.evidence.length} evidence`,
		idea.initiativeId ? `promoted to ${idea.initiativeId}` : "",
	].filter(Boolean);
	return `${idea.id} [${idea.status}] ${idea.title} (${facets.join(", ")})`;
}

function describeIdea(idea: IdeaView): string {
	return [
		...ideaLines(idea),
		`Status: ${idea.status}${idea.initiativeId ? `, promoted to ${idea.initiativeId}${idea.initiative ? ` (${idea.initiative.title})` : ""}` : ""}`,
	].join("\n");
}

function describeWatch(entry: WatchEntry): string {
	const lines = [`${entry.id} · ${entry.name}`, `URLs: ${entry.urls.join(", ") || "none yet"}`];
	if (entry.notes.trim()) lines.push(`Notes: ${entry.notes.trim()}`);
	if (entry.snapshot)
		lines.push(
			`Last snapshot (${isoDay(entry.snapshot.at)}${entry.snapshot.artifactPath ? `, report ${entry.snapshot.artifactPath}` : ""}):`,
			entry.snapshot.text,
		);
	else lines.push("No snapshot yet.");
	return lines.join("\n");
}

/** A path the agent gives inside its workspace, made workspace-relative. */
function workspacePath(cwd: string, path: string): string {
	const trimmed = path.trim();
	if (!isAbsolute(trimmed)) return trimmed;
	const inside = relative(cwd, trimmed);
	if (!inside || inside.startsWith("..") || isAbsolute(inside))
		throw new Error(
			`${trimmed} is outside this workspace; write the report into .thinkrail/context/.`,
		);
	return inside;
}

const trimmed = (items: readonly string[] | undefined) =>
	(items ?? []).map((item) => item.trim()).filter(Boolean);

/**
 * The agent's `board_*` tools over the running board: read cards, file new ones (or a decomposition)
 * into Triage, link "blocks", note progress, read or propose the roadmap's initiatives, projects and
 * draft updates, and — for a container's orchestrator — start its initiative's cards, with the autopilot
 * section in its prompt. A chat knows its card through the attempt that started its workspace.
 */
export function createBoardTools(board: () => Board | undefined): ExtensionFactory {
	const running = (): Board => {
		const current = board();
		if (!current) throw new Error("The board is not running.");
		return current;
	};
	return (pi: ExtensionAPI): void => {
		pi.on("before_agent_start", (event, ctx) => {
			const rule = board()?.orchestratorRule(ctx.sessionManager.getSessionId());
			if (rule) event.systemPromptOptions.sections[AUTOPILOT_SECTION] = rule;
		});
		pi.registerTool({
			name: "board_card_get",
			label: "Board card",
			description:
				"Read a board card: title, description, acceptance criteria, specs, links and progress notes. Without `cardId` it reads the card this chat works on.",
			promptSnippet: "board_card_get — read a board card (default: the card this chat works on).",
			promptGuidelines: [
				"When this chat was started from a board card, read it with board_card_get before you plan, and treat its acceptance criteria as the definition of done.",
			],
			parameters: GetParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const card = params.cardId
					? current.find(params.cardId)
					: current.cardOfSession(ctx.sessionManager.getSessionId(), ctx.cwd)?.card;
				if (!card) return result("This chat works on no board card; pass a cardId.");
				return result(describe(card), card);
			},
		});
		pi.registerTool({
			name: "board_cards_list",
			label: "Board cards",
			description: "List the cards of this project's board, optionally only those in one status.",
			promptSnippet: "board_cards_list — list this project's board cards.",
			parameters: ListParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const cards = current.cards(project.id, params.status);
				return result(
					cards.length > 0
						? cards.map(summary).join("\n")
						: `No cards${params.status ? ` in ${params.status}` : ""} on ${project.name}'s board.`,
				);
			},
		});
		pi.registerTool({
			name: "board_card_create",
			label: "New board card",
			description:
				"File a new card on this project's board. It always lands in Triage, where the human accepts or drops it; your size is shown as a suggestion.",
			promptSnippet:
				"board_card_create — file deferred or follow-up work as a card in Triage for the human.",
			promptGuidelines: [
				"File work you defer or discover outside this task with board_card_create rather than doing it unasked; never use it for steps of the current task.",
			],
			parameters: CreateParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const title = params.title.trim();
				if (!title) throw new Error("Pass a non-empty title.");
				const sessionId = ctx.sessionManager.getSessionId();
				const own = current.cardOfSession(sessionId, ctx.cwd)?.card;
				const card = current.createCard(
					project.id,
					{
						title,
						...(params.description?.trim() ? { description: params.description.trim() } : {}),
						...(params.acceptance
							? { acceptance: params.acceptance.map((item) => item.trim()).filter(Boolean) }
							: {}),
						...(params.type ? { type: params.type } : {}),
						...(params.size ? { size: params.size } : {}),
						origin: { sessionId, ...(own ? { cardId: own.id } : {}) },
					},
					"agent",
				);
				return result(`Filed ${card.id} in Triage: ${card.title}`, card);
			},
		});
		pi.registerTool({
			name: "board_link",
			label: "Link board cards",
			description: "Record that a card blocks other cards of the same board.",
			promptSnippet: "board_link — record that one card blocks others.",
			parameters: LinkParams,
			async execute(_toolCallId, params) {
				const card = running().link(params.cardId, params.blocks);
				return result(`${card.id} now blocks ${card.blocks.join(", ") || "nothing"}.`, card);
			},
		});
		pi.registerTool({
			name: "board_card_note",
			label: "Board progress note",
			description:
				"Add a progress note to the card this chat works on, shown to the human on the card.",
			promptSnippet: "board_card_note — note progress on the card this chat works on.",
			parameters: NoteParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const text = params.text.trim();
				if (!text) throw new Error("Pass a non-empty text.");
				const { card } = running().note(ctx.sessionManager.getSessionId(), ctx.cwd, text);
				return result(`Noted on ${card.id}.`, card);
			},
		});
		pi.registerTool({
			name: "board_initiative_get",
			label: "Board initiative",
			description:
				"Read a roadmap initiative: outcome, success criteria, horizon or target, health with its reasons, forecast, progress, projects and cards. Without `initiativeId` it reads the initiative of the card this chat works on.",
			promptSnippet:
				"board_initiative_get — read a roadmap initiative (default: the one of this chat's card).",
			promptGuidelines: [
				"When this chat's card serves an initiative, keep its outcome and success criteria in mind: they say why the card exists.",
			],
			parameters: InitiativeGetParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				let initiative: Initiative | undefined;
				let boardId = project.id;
				if (params.initiativeId) {
					initiative = current.store
						.initiatives(project.id)
						.initiatives.find(
							(candidate) => candidate.id === params.initiativeId?.trim().toUpperCase(),
						);
					if (!initiative)
						return reply(`No initiative ${params.initiativeId} on ${project.name}'s board.`, {});
				} else {
					const own = current.cardOfSession(ctx.sessionManager.getSessionId(), ctx.cwd);
					const served = own ? current.roadmap.initiativeOfCard(own.projectId, own.card) : null;
					if (!served)
						return reply("This chat's card serves no initiative; pass an initiativeId.", {});
					initiative = served.initiative;
					boardId = served.projectId;
				}
				const view = await current.roadmap.get(boardId);
				const members =
					view.initiatives.find((candidate) => candidate.id === initiative?.id)?.memberCardIds ??
					[];
				const deferrals = await current.deferralsOf(boardId, members);
				return reply(describeInitiative(view, initiative) + describeDeferrals(deferrals), {
					initiative,
				});
			},
		});
		pi.registerTool({
			name: "board_initiative_create_draft",
			label: "Propose an initiative",
			description:
				"Propose a roadmap initiative on this project's board from an idea: its outcome, success criteria and horizon. It is shown to the human as a proposal to accept. Shaping a discovery idea (D-n), pass its ideaId so the idea links to the initiative.",
			promptSnippet:
				"board_initiative_create_draft — propose a roadmap initiative for the human to accept.",
			parameters: InitiativeDraftParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const title = params.title.trim();
				if (!title) throw new Error("Pass a non-empty title.");
				const idea = params.ideaId?.trim()
					? current.discovery.promotable(project.id, params.ideaId)
					: undefined;
				const initiative = current.roadmap.createInitiative(
					project.id,
					{
						title,
						outcome: params.outcome.trim(),
						criteria: trimmed(params.criteria),
						...(params.horizon ? { horizon: params.horizon } : {}),
					},
					"agent",
				);
				const promoted = idea
					? current.discovery.markPromoted(project.id, idea.id, initiative.id)
					: undefined;
				return reply(
					`Proposed ${initiative.id}: ${initiative.title}.${promoted ? ` Idea ${promoted.id} is promoted to it.` : ""} The human accepts it on the board.`,
					{ initiative, ...(promoted ? { idea: promoted } : {}) },
				);
			},
		});
		pi.registerTool({
			name: "board_project_create",
			label: "Propose a roadmap project",
			description:
				"Propose a roadmap project with optional milestones under an initiative of this project's board, shown to the human as a proposal to accept.",
			promptSnippet:
				"board_project_create — propose a project with milestones under an initiative.",
			parameters: ProjectCreateParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const title = params.title.trim();
				if (!title) throw new Error("Pass a non-empty title.");
				const milestones = (params.milestones ?? []).map((milestone) => {
					const target = milestone.target?.trim();
					if (target && !isIsoDate(target))
						throw new Error(`The target ${target} is not a date written YYYY-MM-DD.`);
					return { title: milestone.title.trim(), ...(target ? { target } : {}) };
				});
				if (milestones.some((milestone) => !milestone.title))
					throw new Error("Every milestone needs a title.");
				const created = current.roadmap.createProject(
					project.id,
					{ title, initiativeId: params.initiativeId.trim().toUpperCase(), milestones },
					"agent",
				);
				return reply(
					`Proposed ${created.id}: ${created.title}${created.milestones.length > 0 ? ` with milestones ${created.milestones.map((milestone) => milestone.id).join(", ")}` : ""}.`,
					{ project: created },
				);
			},
		});
		pi.registerTool({
			name: "board_cards_create_batch",
			label: "Decompose into cards",
			description:
				"File a decomposition as cards on this project's board in one go: they land in Triage as one group the human accepts as a whole, with the `blocks` links you give among them and, given one, in a roadmap project.",
			promptSnippet:
				"board_cards_create_batch — file a planned decomposition as one Triage group, with blocks links.",
			promptGuidelines: [
				"Plan an initiative or project into cards with board_cards_create_batch, one call for the whole decomposition, using blocksIndex for the order between them.",
			],
			parameters: BatchParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const sessionId = ctx.sessionManager.getSessionId();
				const own = current.cardOfSession(sessionId, ctx.cwd)?.card;
				const inputs = params.cards.map((card, index) => {
					const title = card.title.trim();
					if (!title) throw new Error(`Card ${index} needs a non-empty title.`);
					return {
						title,
						...(card.description?.trim() ? { description: card.description.trim() } : {}),
						...(card.acceptance ? { acceptance: trimmed(card.acceptance) } : {}),
						...(card.type ? { type: card.type } : {}),
						...(card.size ? { size: card.size } : {}),
						...(card.blocksIndex ? { blocksIndex: card.blocksIndex } : {}),
					};
				});
				const cards = current.createBatch(
					project.id,
					inputs,
					{ sessionId, ...(own ? { cardId: own.id } : {}) },
					params.roadmapProjectId?.trim().toUpperCase() || undefined,
				);
				return reply(
					`Filed ${cards.length} cards in Triage as one group: ${cards.map((card) => `${card.id}${card.blocks.length > 0 ? ` (blocks ${card.blocks.join(", ")})` : ""}`).join(", ")}`,
					{ cards },
				);
			},
		});
		pi.registerTool({
			name: "board_initiative_activity",
			label: "Initiative activity",
			description:
				"Read what moved in a roadmap initiative over the last days, from the board's transition log: cards completed, started, into review, filed and canceled, every move with its actor and reason, progress notes, and the active cards that did not move.",
			promptSnippet:
				"board_initiative_activity — read an initiative's card moves and notes over the last days.",
			parameters: ActivityParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const days = params.sinceDays ?? 7;
				const { initiative, activity, titles } = current.roadmap.activity(
					project.id,
					params.initiativeId.trim().toUpperCase(),
					days,
				);
				return reply(describeActivity(initiative, activity, titles, days), { activity });
			},
		});
		pi.registerTool({
			name: "board_initiative_move",
			label: "Move an initiative",
			description:
				"Move a roadmap initiative to another horizon (now, next or later). Only after the human confirmed this move.",
			promptSnippet:
				"board_initiative_move — move an initiative between Now, Next and Later once the human confirmed it.",
			parameters: MoveParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const initiative = current.roadmap.moveInitiative(
					project.id,
					params.initiativeId.trim().toUpperCase(),
					params.horizon,
				);
				return reply(`Moved ${initiative.id} to ${initiative.horizon}.`, { initiative });
			},
		});
		pi.registerTool({
			name: "board_initiative_close",
			label: "Close an initiative",
			description:
				"Mark a roadmap initiative closed. Only after the human confirmed in this chat that it is done.",
			promptSnippet:
				"board_initiative_close — mark an initiative closed once the human confirmed it is done.",
			parameters: CloseParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const initiative = current.roadmap.closeInitiative(
					project.id,
					params.initiativeId.trim().toUpperCase(),
				);
				return reply(`Closed ${initiative.id}: ${initiative.title}.`, { initiative });
			},
		});
		pi.registerTool({
			name: "board_update_draft",
			label: "Draft an initiative update",
			description:
				"Save a draft status update of an initiative for the human to edit and publish; it replaces an earlier draft and never publishes.",
			promptSnippet:
				"board_update_draft — draft an initiative's status update for the human to publish.",
			parameters: UpdateDraftParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const text = params.text.trim();
				if (!text) throw new Error("Pass a non-empty text.");
				const update = current.roadmap.saveDraft(
					project.id,
					params.initiativeId.trim().toUpperCase(),
					text,
					params.health,
				);
				return reply(`Saved a draft update of ${params.initiativeId}; the human publishes it.`, {
					update,
				});
			},
		});
		pi.registerTool({
			name: "board_ideas_list",
			label: "Discovery ideas",
			description:
				"List this project's discovery ideas with their status and scores, or read one whole: its pitch, evidence (E-n) with quotes, value and effort with their reasons, and suggested horizon.",
			promptSnippet: "board_ideas_list — list the board's discovery ideas, or read one (ideaId).",
			parameters: IdeasListParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const view = current.discovery.get(project.id);
				if (params.ideaId) {
					const id = current.discovery.idea(project.id, params.ideaId).id;
					const idea = view.ideas.find((candidate) => candidate.id === id);
					return idea ? reply(describeIdea(idea), { idea }) : reply(`No idea ${id}.`, {});
				}
				const ideas = view.ideas.filter(
					(idea) => params.status === undefined || idea.status === params.status,
				);
				return reply(
					ideas.length > 0
						? ideas.map(ideaSummary).join("\n")
						: `No ideas${params.status ? ` ${params.status}` : ""} on ${project.name}'s board.`,
					{},
				);
			},
		});
		pi.registerTool({
			name: "board_idea_create",
			label: "New discovery idea",
			description:
				"File a discovery idea on this project's board: a title and a pitch, for the human to research, analyze, promote or dismiss.",
			promptSnippet: "board_idea_create — file a discovery idea (title and pitch) on the board.",
			parameters: IdeaCreateParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const title = params.title.trim();
				if (!title) throw new Error("Pass a non-empty title.");
				const idea = current.discovery.createIdea(project.id, {
					title,
					pitch: params.pitch.trim(),
				});
				return reply(`Filed idea ${idea.id}: ${idea.title}.`, { idea });
			},
		});
		pi.registerTool({
			name: "board_idea_add_evidence",
			label: "Idea evidence",
			description:
				"Attach evidence to a discovery idea: a report you wrote into this workspace's artifacts folder (.thinkrail/context/), a web source's URL, or a note, each with the quote that matters.",
			promptSnippet:
				"board_idea_add_evidence — attach a report, a URL or a note (with its quote) to an idea.",
			parameters: EvidenceParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const artifact = params.kind === "artifact";
				const workspaceId = artifact
					? (current.host.sessionScope({ kind: "all" }).locate(ctx.cwd)?.workspaceId ?? undefined)
					: undefined;
				const { idea, evidence } = current.discovery.addEvidence(
					project.id,
					params.ideaId,
					{
						kind: params.kind,
						ref: artifact ? workspacePath(ctx.cwd, params.ref) : params.ref,
						...(params.quote?.trim() ? { quote: params.quote.trim() } : {}),
						...(workspaceId ? { workspaceId } : {}),
					},
					"agent",
				);
				return reply(`Attached ${evidence.id} (${evidence.kind}) to ${idea.id}.`, { evidence });
			},
		});
		pi.registerTool({
			name: "board_idea_score",
			label: "Score an idea",
			description:
				"Suggest a discovery idea's value and effort (each 1–5 with reasons citing its evidence) and a horizon. They show as suggestions the human confirms or edits; a score the human set is never overwritten.",
			promptSnippet:
				"board_idea_score — suggest an idea's value, effort (1–5, with reasons) and horizon.",
			parameters: ScoreParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const { idea, kept } = current.discovery.suggestScores(project.id, params.ideaId, {
					...(params.value
						? { value: { score: params.value.score, reasons: params.value.reasons } }
						: {}),
					...(params.effort
						? { effort: { score: params.effort.score, reasons: params.effort.reasons } }
						: {}),
					...(params.horizon
						? { horizon: { horizon: params.horizon.horizon, reason: params.horizon.reason } }
						: {}),
				});
				const keptText = kept
					.map((key) => ` The human set ${key} ${idea[key]?.score}; it stays.`)
					.join("");
				return reply(
					`Suggested on ${idea.id}: ${scoreText(idea) || "no score"}${idea.horizonSuggestion ? `, horizon ${idea.horizonSuggestion.horizon}` : ""}.${keptText} The human decides.`,
					{ idea, kept },
				);
			},
		});
		pi.registerTool({
			name: "board_watchlist_get",
			label: "Competitor watchlist",
			description:
				"Read this project's competitor watchlist, or one entry: names, URLs, notes and the last snapshot's text and date.",
			promptSnippet: "board_watchlist_get — read the competitor watchlist and its last snapshots.",
			parameters: WatchGetParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const entries = params.watchId
					? [current.discovery.watchEntry(project.id, params.watchId)]
					: current.discovery.get(project.id).watchlist;
				return reply(
					entries.length > 0
						? entries.map(describeWatch).join("\n\n")
						: `${project.name}'s competitor watchlist is empty.`,
					{ entries },
				);
			},
		});
		pi.registerTool({
			name: "board_watchlist_snapshot",
			label: "Store a competitor snapshot",
			description:
				"Store a watchlist entry's new snapshot (what the competitor offers now, as text) with its dated report; it returns the previous snapshot to diff against.",
			promptSnippet:
				"board_watchlist_snapshot — store a competitor's new snapshot; returns the previous one.",
			parameters: SnapshotParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfChat(ctx.sessionManager.getSessionId(), ctx.cwd);
				const workspaceId = params.artifactPath
					? (current.host.sessionScope({ kind: "all" }).locate(ctx.cwd)?.workspaceId ?? undefined)
					: undefined;
				const { entry, previous } = current.discovery.snapshot(project.id, params.watchId, {
					text: params.text,
					...(params.artifactPath
						? { artifactPath: workspacePath(ctx.cwd, params.artifactPath) }
						: {}),
					...(workspaceId ? { workspaceId } : {}),
				});
				return reply(
					previous
						? `Stored the snapshot of ${entry.id} (${entry.name}). The previous one, of ${isoDay(previous.at)}, to diff against:\n\n${previous.text}`
						: `Stored the first snapshot of ${entry.id} (${entry.name}); there is no previous one to compare with.`,
					{ entry, previous },
				);
			},
		});
		pi.registerTool({
			name: "board_card_start",
			label: "Start a board card",
			description:
				"Start a card of the initiative this container runs as a new workspace of this container, on the card's kickoff with your note appended. For a container's orchestrator (or a chat of one of its workspaces); only ready, unblocked cards of that initiative start. Unless the human asked for it, the orchestrator's start also needs the initiative's autopilot on and not paused, and an agent slot under the board's limit.",
			promptSnippet:
				"board_card_start — start a card of this container's initiative as a new member workspace.",
			parameters: StartParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const started = await running().startForContainer(
					ctx.sessionManager.getSessionId(),
					ctx.cwd,
					params.cardId.trim(),
					{
						...(params.workflow ? { workflow: params.workflow } : {}),
						...(params.note ? { note: params.note } : {}),
						automated: !answersHuman(ctx.sessionManager.getBranch()),
					},
				);
				const { card, attempt, container } = started;
				const failed = started.kickoffError
					? ` Its chat did not take the kickoff: ${started.kickoffError}`
					: "";
				return result(
					`Started ${card.id} (${attempt.workflow}) as workspace ${attempt.workspaceId} of the container "${container.name}", chat ${attempt.sessionId}.${failed} You are woken when its chat settles.`,
					card,
				);
			},
		});
	};
}
