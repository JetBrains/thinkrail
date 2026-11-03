import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DEFAULT_ENDPOINT } from "./client";
import { ANTIGRAVITY_MODELS, refreshAntigravityModels } from "./models";
import { getAntigravityApiKey, loginAntigravity, refreshAntigravityToken } from "./oauth";
import { ANTIGRAVITY_API, streamAntigravity } from "./stream";

export {
	DEFAULT_ENDPOINT,
	DEFAULT_USER_AGENT,
	defaultProjectId,
	ENDPOINT_FALLBACKS,
	endpointCandidates,
	extractProjectId,
	loadCodeAssist,
	parseAntigravityApiKey,
	resolveProjectId,
	stableProjectId,
} from "./client";
export {
	ANTIGRAVITY_MODELS,
	type AntigravityModelFamily,
	getAntigravityRequestModelId,
	getMaxOutputTokens,
	getModelFamily,
	getThinkingConfig,
	refreshAntigravityModels,
} from "./models";
export {
	AUTH_URL,
	buildAuthorizationUrl,
	CLIENT_ID,
	CLIENT_SECRET,
	exchangeAuthorizationCode,
	generatePKCE,
	getAntigravityApiKey,
	handleCallbackRequest,
	loginAntigravity,
	parsePastedCallback,
	REDIRECT_URI,
	refreshAntigravityToken,
	SCOPES,
	TOKEN_URL,
} from "./oauth";
export {
	ANTIGRAVITY_API,
	buildRequest,
	convertAssistantMessage,
	convertMessages,
	convertToolResultMessage,
	convertTools,
	streamAntigravity,
	streamResponse,
} from "./stream";

export function registerAntigravityProvider(runtime: ModelRuntime): void {
	runtime.registerProvider("antigravity", {
		name: "Antigravity",
		baseUrl: DEFAULT_ENDPOINT,
		api: ANTIGRAVITY_API,
		models: ANTIGRAVITY_MODELS,
		refreshModels: refreshAntigravityModels,
		oauth: {
			name: "Antigravity",
			isSubscription: true,
			login: loginAntigravity,
			refreshToken: refreshAntigravityToken,
			getApiKey: getAntigravityApiKey,
		},
		streamSimple: streamAntigravity,
	});
}
