import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Board } from "./board";
import { isIsoDate } from "./days";
import {
	CARD_SIZES,
	CARD_TYPES,
	CATEGORIES,
	type Card,
	HEALTHS,
	HORIZONS,
	type Initiative,
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

const trimmed = (items: readonly string[] | undefined) =>
	(items ?? []).map((item) => item.trim()).filter(Boolean);

/**
 * The agent's `board_*` tools over the running board: read cards, file new ones (or a decomposition)
 * into Triage, link "blocks", note progress, and read or propose the roadmap's initiatives, projects and
 * draft updates. A chat knows its card through the attempt that started its workspace.
 */
export function createBoardTools(board: () => Board | undefined): ExtensionFactory {
	const running = (): Board => {
		const current = board();
		if (!current) throw new Error("The board is not running.");
		return current;
	};
	return (pi: ExtensionAPI): void => {
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
				const project = current.projectOfCwd(ctx.cwd);
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
				const project = current.projectOfCwd(ctx.cwd);
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
				const project = current.projectOfCwd(ctx.cwd);
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
				return reply(describeInitiative(view, initiative), { initiative });
			},
		});
		pi.registerTool({
			name: "board_initiative_create_draft",
			label: "Propose an initiative",
			description:
				"Propose a roadmap initiative on this project's board from an idea: its outcome, success criteria and horizon. It is shown to the human as a proposal to accept.",
			promptSnippet:
				"board_initiative_create_draft — propose a roadmap initiative for the human to accept.",
			parameters: InitiativeDraftParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfCwd(ctx.cwd);
				const title = params.title.trim();
				if (!title) throw new Error("Pass a non-empty title.");
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
				return reply(
					`Proposed ${initiative.id}: ${initiative.title}. The human accepts it on the board.`,
					{
						initiative,
					},
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
				const project = current.projectOfCwd(ctx.cwd);
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
				const project = current.projectOfCwd(ctx.cwd);
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
			name: "board_update_draft",
			label: "Draft an initiative update",
			description:
				"Save a draft status update of an initiative for the human to edit and publish; it replaces an earlier draft and never publishes.",
			promptSnippet:
				"board_update_draft — draft an initiative's status update for the human to publish.",
			parameters: UpdateDraftParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const current = running();
				const project = current.projectOfCwd(ctx.cwd);
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
	};
}
