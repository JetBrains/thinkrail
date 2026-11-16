import {
	defineServerExtension,
	type ExtensionSessionServices,
} from "@thinkrail/extension-api/server";
import {
	type AskUserQuestionAsker,
	createAskUserQuestionExtension,
	isAskUserQuestionResult,
} from "@thinkrail/pi-ask-user-question";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	buildQuestionnaireResponse,
	isAskUserQuestionArgs,
	previewFileSources,
} from "@thinkrail/pi-ask-user-question/core";
import { thinkrailGuidance } from "./guidance";

function askThroughHost(session: ExtensionSessionServices): AskUserQuestionAsker {
	return async ({ toolCallId, signal }) => {
		const response = await session.awaitToolResponse(toolCallId, signal);
		if (response.kind !== "response") return response;
		if (!isAskUserQuestionResult(response.value))
			throw new Error("Malformed ask_user_question response");
		return { kind: "answered", result: response.value };
	};
}

function describeResponse(args: unknown, response: unknown): string | undefined {
	if (!isAskUserQuestionArgs(args) || !isAskUserQuestionResult(response)) return undefined;
	return buildQuestionnaireResponse(response, args)
		.content.map((block) => block.text)
		.join("");
}

function previewedPaths(args: unknown): string[] {
	return isAskUserQuestionArgs(args) ? previewFileSources(args).map((source) => source.path) : [];
}

function pickedPaths(_args: unknown, details: unknown): string[] {
	if (typeof details !== "object" || details === null || !("answers" in details)) return [];
	if (!Array.isArray(details.answers)) return [];
	return details.answers.flatMap((answer: unknown) =>
		typeof answer === "object" &&
		answer !== null &&
		"previewFile" in answer &&
		typeof answer.previewFile === "string" &&
		answer.previewFile
			? [answer.previewFile]
			: [],
	);
}

export default defineServerExtension({
	name: "ask-user-question",
	title: "Ask user question",
	description:
		"Lets the agent pause and ask you structured multiple-choice questions in chat instead of guessing.",
	extensions: [],
	settings: { richPreviews: { type: "boolean", default: true } },
	sessionExtensions: (session) => [
		(pi) => {
			const filePreviews = session.setting("richPreviews");
			return createAskUserQuestionExtension({
				ask: askThroughHost(session),
				announce: (toolCallId) => session.expectToolResponse(toolCallId),
				guidance: thinkrailGuidance(filePreviews, session.workspaceFiles.scratchDir),
				filePreviews,
				checkFile: session.workspaceFiles.check,
			})(pi);
		},
	],
	interactiveTools: { [ASK_USER_QUESTION_TOOL_NAME]: { describeResponse } },
	artifactTools: {
		[ASK_USER_QUESTION_TOOL_NAME]: { presented: previewedPaths, picked: pickedPaths },
	},
});
