import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Board } from "./board";
import { CARD_SIZES, CARD_TYPES, CATEGORIES, type Card } from "./model";

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

/**
 * The agent's `board_*` tools over the running board: read cards, file new ones into Triage, link
 * "blocks" and note progress. A chat knows its card through the attempt that started its workspace.
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
	};
}
