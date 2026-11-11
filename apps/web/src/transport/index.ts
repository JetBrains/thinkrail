export {
	attachmentFailureText,
	type PromptFileUploadOptions,
	supportsChatAttachments,
	uploadPromptFiles,
} from "./attachments";
export {
	clientErrorReport,
	installClientErrorReporting,
	reportClientError,
} from "./errorReports";
export { errorText } from "./errorText";
export { hostUrl, uploadUserFont } from "./fonts";
export { instanceToken, setInstanceTokenForTests } from "./instanceToken";
export {
	requestMcpList,
	requestUserMcpList,
	supportsUserMcp,
	type UserMcpListMethod,
	watchMcpWorkspace,
} from "./mcp";
export { RequestError, RequestTimeoutError, wsErrorCode } from "./requestError";
export {
	createSessionWithSkillBaseline,
	getSessionMessagesWithSkillBaseline,
	prewarmWorkspaceSkillLoad,
	reloadSessionResourcesWithSkillBaseline,
} from "./skillLoad";
export { openSpeechSocket } from "./speech";
export type { ConnectionStatus, TransportOptions } from "./transport";
export {
	forgetInAppSurvey,
	getTransport,
	initTransport,
	loadInAppSurvey,
	respondToTool,
	runHostUpdate,
	supportsChangeMutations,
	supportsExtensionSettings,
	supportsFonts,
	supportsHostUpdateRun,
	supportsKeybindings,
	supportsPiPackages,
	supportsPlanReview,
	supportsPlanSummaryGeneration,
	supportsRichAnchors,
	supportsSpeech,
	supportsTextSearch,
	supportsToolResponses,
	supportsTurnChanges,
	supportsUserThemes,
	updateKeybindings,
} from "./wireTransport";
