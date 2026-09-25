import type { PiExtensionFactory } from "@thinkrail/ext";
import { Type } from "typebox";
import { type AddNoteDetails, BODY_LIMIT, SECTION, TITLE_LIMIT, titleOf } from "./model";

export interface SessionTarget {
	sessionId: string;
	cwd: string;
}

export interface NotesPiDeps {
	sectionFor: (target: SessionTarget) => Promise<string>;
	addForAgent: (target: SessionTarget, draft: { title: string; body: string }) => Promise<AgentAdd>;
}

export type AgentAdd = { ok: true; details: AddNoteDetails } | { ok: false; error: string };

const AddNoteParams = Type.Object({
	body: Type.String({
		description: `The note in markdown, written as a standing instruction or fact (max ${BODY_LIMIT} characters).`,
	}),
	title: Type.Optional(
		Type.String({ description: `A short title (max ${TITLE_LIMIT} characters).` }),
	),
});

export const notesPi =
	({ sectionFor, addForAgent }: NotesPiDeps): PiExtensionFactory =>
	(pi) => {
		pi.on("before_agent_start", async (event, ctx) => {
			const text = await sectionFor({
				sessionId: ctx.sessionManager.getSessionId(),
				cwd: ctx.cwd,
			});
			if (text) event.systemPromptOptions.sections[SECTION] = text;
			else delete event.systemPromptOptions.sections[SECTION];
			return undefined;
		});

		pi.registerTool({
			name: "add_project_note",
			label: "Add project note",
			description:
				"Pin a note for this project. Enabled notes are added to the system prompt of every later agent run in the project. Use it only when the user asks you to remember something ('remember that…', 'always…', 'note that…').",
			promptSnippet: "Pin a note the user asks you to remember for this project",
			parameters: AddNoteParams,
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const result = await addForAgent(
					{ sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd },
					{ title: params.title ?? "", body: params.body },
				);
				if (!result.ok) throw new Error(result.error);
				const { details } = result;
				const tail = details.sent
					? "It is added to the system prompt of every new run in this project."
					: "It is saved but over the project notes size cap, so it is not sent until the user frees space.";
				return {
					content: [
						{ type: "text", text: `Saved project note "${titleOf(details.note)}". ${tail}` },
					],
					details,
				};
			},
		});
	};
