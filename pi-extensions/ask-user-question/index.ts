import { createAskUserQuestionExtension } from "./src/extension.ts";

export type {
	AskOutcome,
	AskRequest,
	AskToolResult,
	AskUserQuestionAckDetails,
	AskUserQuestionAnswer,
	AskUserQuestionArgs,
	AskUserQuestionAsker,
	AskUserQuestionDetails,
	AskUserQuestionItem,
	AskUserQuestionOption,
	AskUserQuestionResult,
	ValidationResult,
} from "./src/core.ts";
export {
	ASK_ACK_TEXT,
	ASK_CHAT_TEXT,
	ASK_STOPPED_ERROR,
	ASK_UNAVAILABLE_TEXT,
	ASK_USER_QUESTION_TOOL_NAME,
	buildQuestionnaireResponse,
	CHAT_LABEL,
	DECLINE_MESSAGE,
	executableAskCallIds,
	isAckDetails,
	isAskUserQuestionResult,
	isolateAskUserQuestionBatch,
	MAX_HEADER_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_OPTIONS,
	MAX_RECOMMENDED_REASON_LENGTH,
	MIN_OPTIONS,
	OTHER_LABEL,
	outcomeResult,
	RESERVED_LABELS,
	validateQuestionnaire,
} from "./src/core.ts";
export type {
	AskUserQuestionExtensionOptions,
	AskUserQuestionGuidance,
} from "./src/extension.ts";
export {
	createAskUserQuestionExtension,
	DEFAULT_DESCRIPTION,
	DEFAULT_PROMPT_GUIDELINES,
} from "./src/extension.ts";
export { type AskUserQuestionParams, AskUserQuestionSchema } from "./src/schema.ts";

export default createAskUserQuestionExtension();
