export {
	clientErrorReport,
	installClientErrorReporting,
	reportClientError,
} from "./errorReports";
export { errorText } from "./errorText";
export { hostUrl, uploadUserFont } from "./fonts";
export { isHostResetting, onHostReset } from "./hostReset";
export { requestMcpList, watchMcpWorkspace } from "./mcp";
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
	mountRemoteSession,
	respondToTool,
	runHostUpdate,
	supportsChangeMutations,
	supportsExtensionSettings,
	supportsFonts,
	supportsHostUpdateRun,
	supportsPiPackages,
	supportsPlanReview,
	supportsPlanSummaryGeneration,
	supportsRichAnchors,
	supportsSpeech,
	supportsTextSearch,
	supportsToolResponses,
	supportsTurnChanges,
	supportsUserThemes,
} from "./wireTransport";
