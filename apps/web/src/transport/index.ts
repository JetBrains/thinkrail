export {
	clientErrorReport,
	installClientErrorReporting,
	reportClientError,
} from "./errorReports";
export { errorText } from "./errorText";
export { hostUrl, uploadUserFont } from "./fonts";
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
	supportsContainers,
	supportsExtensionQuery,
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
