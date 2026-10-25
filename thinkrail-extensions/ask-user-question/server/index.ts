import {
	defineServerExtension,
	type ExtensionSessionServices,
} from "@thinkrail/extension-api/server";
import {
	type AskUserQuestionAsker,
	createAskUserQuestionExtension,
	isAskUserQuestionResult,
} from "@thinkrail/pi-ask-user-question";
import { THINKRAIL_GUIDANCE } from "./guidance";

export {
	ASK_ACK_TEXT,
	ASK_STOPPED_ERROR,
	ASK_USER_QUESTION_TOOL_NAME,
	buildQuestionnaireResponse,
	isAckDetails,
} from "@thinkrail/pi-ask-user-question/core";

function askThroughHost(session: ExtensionSessionServices): AskUserQuestionAsker {
	return async ({ toolCallId, signal }) => {
		const response = await session.awaitToolResponse(toolCallId, signal);
		if (response.kind !== "response") return response;
		if (!isAskUserQuestionResult(response.value))
			throw new Error("Malformed ask_user_question response");
		return { kind: "answered", result: response.value };
	};
}

export default defineServerExtension({
	name: "ask-user-question",
	title: "Ask user question",
	description:
		"Lets the agent pause and ask you structured multiple-choice questions in chat instead of guessing.",
	extensions: [],
	sessionExtensions: (session) => [
		createAskUserQuestionExtension({ ask: askThroughHost(session), guidance: THINKRAIL_GUIDANCE }),
	],
});
