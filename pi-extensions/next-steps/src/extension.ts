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
		{ minItems: 1, description: "The most useful next messages, best first. Usually about 3." },
	),
});

export type NextStepsParams = Static<typeof NextStepsSchema>;

export const DEFAULT_DESCRIPTION =
	"Offer the user one-click next messages after you finish a turn. The user sees them as quick replies (keyboard shortcuts in the terminal, buttons in a GUI host); picking one sends it as the user's next message. Ends your turn.";

export const DEFAULT_PROMPT_SNIPPET =
	"Offer one-click next messages as the last action of a finished turn";

export const DEFAULT_PROMPT_GUIDELINES: readonly string[] = [
	"When a turn's work is finished, write your final message first, then call suggest_next_steps alone as the very last action of the turn: it ends the turn, so never call it before you are done or alongside other tools.",
	'Each suggestion is a message the user would plausibly send next, in their voice and language — e.g. "Run the e2e suite", "Also handle the empty state", "Open a PR". When your final message ends with a question, offer short answers to it, e.g. "Yes, go ahead" or "Use option B".',
	"Offer only genuinely useful next steps, best first, usually about three. Skip the call entirely when nothing meaningful applies, while you are waiting on the user's answer to a question tool, or when the turn ended in an error.",
];

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

export function createSuggestNextStepsTool(): ToolDefinition<
	typeof NextStepsSchema,
	NextStepsDetails
> {
	return {
		name: NEXT_STEPS_TOOL_NAME,
		label: "Suggest Next Steps",
		description: DEFAULT_DESCRIPTION,
		promptSnippet: DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: [...DEFAULT_PROMPT_GUIDELINES],
		parameters: NextStepsSchema,
		async execute(_toolCallId, params: NextStepsParams) {
			const suggestions = normalizeSuggestions(params.suggestions);
			const text =
				suggestions.length > 0
					? "Shown to the user as one-click next messages. Your turn is over."
					: "No usable suggestions were given. Your turn is over.";
			return { content: [{ type: "text", text }], details: { suggestions }, terminate: true };
		},
		renderCall: (args, theme) => renderNextStepsCall(args, theme),
		renderResult: (result, _options, theme) => renderNextStepsResult(result, theme),
	};
}

export function createNextStepsExtension(): ExtensionFactory {
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

		pi.registerTool(createSuggestNextStepsTool());
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
