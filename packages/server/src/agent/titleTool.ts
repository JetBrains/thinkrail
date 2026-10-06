import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

export const SET_TITLE_TOOL_NAME = "set_title";

export const SetTitleSchema = Type.Object({
	chat_title: Type.Optional(
		Type.String({ description: "3–6 words naming this conversation, in the user's language." }),
	),
	workspace_name: Type.Optional(
		Type.String({ description: "2–5 words naming the task, in the user's language." }),
	),
	branch: Type.Optional(
		Type.String({
			description:
				'Short English kebab-case slug for the workspace branch, e.g. "fix-auth-redirect". Only together with workspace_name.',
		}),
	),
});

export type SetTitleParams = Static<typeof SetTitleSchema>;

const DESCRIPTION =
	"Name this conversation and its workspace. Call it once, as soon as the task is clear, passing every name still missing in that one call. A name that is already set — by an earlier call or by the user — is kept; the result says what was applied.";

const PROMPT_SNIPPET = "Name this conversation and its workspace (once, at the start of the task)";

const PROMPT_GUIDELINES = [
	"Call set_title once per conversation, with chat_title, workspace_name and branch together, as your first action in the first turn that has a concrete task, before answering or using other tools, even when the answer is a single sentence. When the request links a PR, issue, or ticket, call it right after you have read that item's number and title. Only skip it while there is no concrete task yet (a greeting, an open question), then call it in the first later turn that has one.",
	"Write chat_title and workspace_name in the language the user writes in; branch is always a short English kebab-case slug.",
	"When the task is about a PR, issue, or ticket, read it first and name it `<Verb> #<number> <its exact title>`, e.g. `Review #567 Add page zoom shortcuts` with branch `review-567-page-zoom`.",
	"A name the result reports as kept is final: do not call set_title again to change it.",
];

export interface TitleToolHost {
	apply: (sessionId: string, params: SetTitleParams) => Promise<string>;
	workspaceNeedsName: (sessionId: string) => boolean;
}

const unavailableHost: TitleToolHost = {
	apply: () => {
		throw new Error("Naming is not available on this host.");
	},
	workspaceNeedsName: () => false,
};

let host: TitleToolHost = unavailableHost;

export function setTitleToolHost(next: TitleToolHost | null): void {
	host = next ?? unavailableHost;
}

const TITLE_SECTION = "pending-naming";

export function pendingNamingRule(chatUnnamed: boolean, workspaceUnnamed: boolean): string | null {
	const missing = [
		...(chatUnnamed ? ["this chat has no title"] : []),
		...(workspaceUnnamed ? ["its workspace has no name"] : []),
	];
	if (missing.length === 0) return null;
	const fields = [
		...(chatUnnamed ? ["chat_title"] : []),
		...(workspaceUnnamed ? ["workspace_name", "branch"] : []),
	];
	const fieldList =
		fields.length > 1 ? `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}` : fields[0];
	return `Naming is still pending: ${missing.join(" and ")} yet. If this request has a concrete task, call set_title with ${fieldList} before your other tool calls (right after reading a linked PR, issue, or ticket, if any). Otherwise ignore this note.`;
}

export function createSetTitleTool(): ToolDefinition<typeof SetTitleSchema, SetTitleParams> {
	return {
		name: SET_TITLE_TOOL_NAME,
		label: "Set Title",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: SetTitleSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const input = params as SetTitleParams;
			const text = await host.apply(ctx.sessionManager.getSessionId(), input);
			return { content: [{ type: "text", text }], details: input };
		},
	};
}

export function setTitleExtension(pi: ExtensionAPI): void {
	pi.registerTool(createSetTitleTool());
	pi.on("before_agent_start", (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const rule = pendingNamingRule(
			ctx.sessionManager.getSessionName() === undefined,
			host.workspaceNeedsName(sessionId),
		);
		if (rule) event.systemPromptOptions.sections[TITLE_SECTION] = rule;
		else delete event.systemPromptOptions.sections[TITLE_SECTION];
	});
}
