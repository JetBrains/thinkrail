/**
 * Anonymous usage analytics (see SPEC.md — the privacy contract). Consumed by `host` ONLY: every
 * `track()` call site lives there, feature modules never know analytics exists.
 */
export {
	type AnalyticsEvent,
	bucketProvider,
	bucketProviderModel,
	type LoginMethod,
	type SendMode,
} from "./events";
export {
	type AnalyticsOptions,
	initializeAnalytics,
	resetAnalyticsForTests,
	setAnalyticsSending,
	shutdownAnalytics,
	track,
} from "./service";
