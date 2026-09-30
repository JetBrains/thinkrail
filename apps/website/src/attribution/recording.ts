import { currentJourneyId, currentMarketingConsent, subscribeJourney } from "../analytics";
import {
	type AttributionStorage,
	type BridgeIdGenerator,
	clearAttributionContext,
	createBridgeId,
	recordAttributionTouch,
	storeLatestAttributionBridge,
} from "./browserStorage";

type AttributionRecordingDependencies = {
	currentJourneyId(): string | undefined;
	currentMarketingConsent(): boolean | undefined;
	subscribeJourney(listener: (journeyId: string | undefined) => void): () => void;
	storage(): AttributionStorage | undefined;
	href(): string | undefined;
	referrer(): string | undefined;
	generateBridgeId: BridgeIdGenerator;
};

const browserDependencies: AttributionRecordingDependencies = {
	currentJourneyId,
	currentMarketingConsent,
	subscribeJourney,
	storage() {
		if (typeof window === "undefined") return undefined;
		try {
			return window.localStorage;
		} catch {
			return undefined;
		}
	},
	href: () => (typeof window === "undefined" ? undefined : window.location.href),
	referrer: () => (typeof document === "undefined" ? undefined : document.referrer),
	generateBridgeId: createBridgeId,
};

export function recordCurrentAttributionTouch(
	dependencies: AttributionRecordingDependencies = browserDependencies,
): void {
	const journeyId = dependencies.currentJourneyId();
	if (journeyId === undefined) return;
	const storage = dependencies.storage();
	const href = dependencies.href();
	const referrer = dependencies.referrer();
	if (storage === undefined || href === undefined || referrer === undefined) return;
	recordAttributionTouch(journeyId, href, referrer, storage);
}

export function recordCurrentDownloadBridge(
	dependencies: AttributionRecordingDependencies = browserDependencies,
): string | undefined {
	const journeyId = dependencies.currentJourneyId();
	if (journeyId === undefined) return undefined;
	const storage = dependencies.storage();
	if (storage === undefined) return undefined;
	return storeLatestAttributionBridge(journeyId, storage, dependencies.generateBridgeId);
}

export function initAttributionRecording(
	dependencies: AttributionRecordingDependencies = browserDependencies,
): void {
	const storage = dependencies.storage();
	if (storage === undefined) return;
	const consent = dependencies.currentMarketingConsent();
	if (consent === false) clearAttributionContext(storage);
	else if (consent === true) recordCurrentAttributionTouch(dependencies);

	dependencies.subscribeJourney((journeyId) => {
		if (journeyId === undefined && dependencies.currentMarketingConsent() === false)
			clearAttributionContext(storage);
	});
}
