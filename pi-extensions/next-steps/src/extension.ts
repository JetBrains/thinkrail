import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import {
	NEXT_STEPS_TOOL_NAME,
	type NextStepsDetails,
	normalizeSuggestions,
	suggestionsOnBranch,
} from "./core.ts";
import { renderNextStepsCall, renderNextStepsResult, SuggestionRow } from "./tui.ts";

export const NextStepsSchema = Type.Object({
	suggestions: Type.Array(
		Type.String({
			description:
				"One message the user could send next, written in their voice and language, short enough for a button (about 2–8 words).",
		}),
		{
			minItems: 1,
			description: "The most useful next messages, best first. Usually about 3, at most 9.",
		},
	),
});

export type NextStepsParams = Static<typeof NextStepsSchema>;

export const DEFAULT_DESCRIPTION =
	"Offer the user one-click next messages when your turn's work is finished. The user sees them as quick replies (keyboard shortcuts in the terminal, buttons in a GUI host); picking one sends it as the user's next message. Call it right before your final message, then write that message as the last thing in your turn.";

export const DEFAULT_PROMPT_SNIPPET =
	"Offer one-click next messages once a turn's work is finished, right before the final message";

export const DEFAULT_PROMPT_GUIDELINES: readonly string[] = [
	"When a turn's work is finished, call suggest_next_steps alone, then write your final message to the user as plain text: the last thing in your turn, with no tool call after it. Write none of that message before the call, where it can reach the user cut to a short summary. Never call it before you are done (for example while plan steps remain) or alongside other tools.",
	'Each suggestion is a message the user would plausibly send next, in their voice and language — e.g. "Run the e2e suite", "Also handle the empty state", "Open a PR". When your final message will end with a question, offer short answers to it, e.g. "Yes, go ahead" or "Use option B".',
	"Offer only genuinely useful next steps, best first, usually about three. Skip the call entirely when nothing meaningful applies, while you are waiting on the user's answer to a question tool or on background work you started, or when the turn ended in an error.",
];

export interface NextStepsGuidance {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
}

export interface NextStepsExtensionOptions {
	guidance?: NextStepsGuidance;
}

export const WRITE_ANSWER_TEXT =
	"Now write your final message to the user as plain text: the last thing in your turn, with no tool call after it.";

const WIDGET_KEY = "next-steps";

const SHORTCUTS = [
	"alt+1",
	"alt+2",
	"alt+3",
	"alt+4",
	"alt+5",
	"alt+6",
	"alt+7",
	"alt+8",
	"alt+9",
] as const satisfies readonly KeyId[];

export function createSuggestNextStepsTool(
	options: NextStepsExtensionOptions = {},
): ToolDefinition<typeof NextStepsSchema, NextStepsDetails> {
	const guidance = options.guidance ?? {};
	return {
		name: NEXT_STEPS_TOOL_NAME,
		label: "Suggest Next Steps",
		description: guidance.description ?? DEFAULT_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: [...(guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES)],
		parameters: NextStepsSchema,
		async execute(_toolCallId, params: NextStepsParams) {
			const suggestions = normalizeSuggestions(params.suggestions);
			const outcome =
				suggestions.length > 0
					? "Saved: the user sees them as one-click next messages under your final message."
					: "No usable suggestions were given.";
			return {
				content: [{ type: "text", text: `${outcome} ${WRITE_ANSWER_TEXT}` }],
				details: { suggestions },
				terminate: false,
			};
		},
		renderCall: (args, theme) => renderNextStepsCall(args, theme),
		renderResult: (result, _options, theme) => renderNextStepsResult(result, theme),
	};
}

export function createNextStepsExtension(
	options: NextStepsExtensionOptions = {},
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		let offered: readonly string[] = [];

		const clear = (ctx: ExtensionContext) => {
			if (offered.length === 0) return;
			offered = [];
			if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		};

		const showFromLeaf = (ctx: ExtensionContext) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) return;
			const suggestions = suggestionsOnBranch(ctx.sessionManager.getBranch());
			if (suggestions.length === 0) return clear(ctx);
			offered = suggestions;
			ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new SuggestionRow(suggestions, theme));
		};

		pi.registerTool(createSuggestNextStepsTool(options));
		pi.on("agent_start", (_event, ctx) => clear(ctx));
		pi.on("agent_settled", (event, ctx) => (event.aborted ? clear(ctx) : showFromLeaf(ctx)));
		pi.on("session_start", (_event, ctx) => showFromLeaf(ctx));
		pi.on("session_tree", (_event, ctx) => showFromLeaf(ctx));

		SHORTCUTS.forEach((shortcut, index) => {
			pi.registerShortcut(shortcut, {
				description: `Send next-step suggestion ${index + 1}`,
				handler: (ctx) => {
					const text = offered[index];
					if (!text) return;
					clear(ctx);
					pi.sendUserMessage(text);
				},
			});
		});
	};
}
