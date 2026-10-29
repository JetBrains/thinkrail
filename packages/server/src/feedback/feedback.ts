import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SurveyInvitationResponse } from "@thinkrail/contracts";
import { dataDir } from "../persistence";
import { currentInAppSurvey, refreshInAppSurvey, surveyRefreshDue } from "./survey";

interface FeedbackState {
	acceptedMessages: number;
	nextInvitationAt: number;
	dismissed: boolean;
	submittedSurveyId: string | null;
	submittedIteration: number | null;
}

type FeedbackPublisher = (clientKey: string) => boolean;

const INVITATION_INTERVAL = 10;
const DEFAULT_STATE: FeedbackState = {
	acceptedMessages: 0,
	nextInvitationAt: INVITATION_INTERVAL,
	dismissed: false,
	submittedSurveyId: null,
	submittedIteration: null,
};

let cachedState: FeedbackState | null = null;
let claimedClient: string | null = null;
let publishInvitation: FeedbackPublisher | null = null;

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseState(value: unknown): FeedbackState | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<FeedbackState>;
	if (
		!isNonNegativeSafeInteger(candidate.acceptedMessages) ||
		!isNonNegativeSafeInteger(candidate.nextInvitationAt) ||
		typeof candidate.dismissed !== "boolean"
	) {
		return null;
	}
	const submittedSurveyId = completionId(value);
	const submittedIteration = completionIteration(value);
	if (submittedSurveyId === undefined || submittedIteration === undefined) return null;
	return {
		acceptedMessages: candidate.acceptedMessages,
		nextInvitationAt: candidate.nextInvitationAt,
		dismissed: candidate.dismissed,
		submittedSurveyId,
		submittedIteration,
	};
}

function completionId(record: object): string | null | undefined {
	if (!Object.hasOwn(record, "submittedSurveyId")) return null;
	const id: unknown = Reflect.get(record, "submittedSurveyId");
	if (id === null) return null;
	if (typeof id === "string" && id.length > 0 && id.length <= 128) return id;
	return undefined;
}

function completionIteration(record: object): number | null | undefined {
	if (!Object.hasOwn(record, "submittedIteration")) return null;
	const iteration: unknown = Reflect.get(record, "submittedIteration");
	if (iteration === null) return null;
	if (isNonNegativeSafeInteger(iteration)) return iteration;
	return undefined;
}

function loadState(): FeedbackState {
	if (cachedState) return cachedState;
	try {
		cachedState = parseState(
			JSON.parse(readFileSync(join(dataDir(), "feedback.json"), "utf8")),
		) ?? {
			...DEFAULT_STATE,
		};
	} catch {
		cachedState = { ...DEFAULT_STATE };
	}
	return cachedState;
}

function writeState(next: FeedbackState): void {
	const directory = dataDir();
	const file = join(directory, "feedback.json");
	const temporary = `${file}.${process.pid}.tmp`;
	mkdirSync(directory, { recursive: true });
	try {
		writeFileSync(temporary, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
		renameSync(temporary, file);
	} catch (error) {
		try {
			rmSync(temporary, { force: true, recursive: true });
		} catch {}
		throw error;
	}
}

function saveState(next: FeedbackState): void {
	writeState(next);
	cachedState = next;
}

function addWithinSafeRange(value: number, amount: number): number {
	return Math.min(value + amount, Number.MAX_SAFE_INTEGER);
}

export function setFeedbackPublisher(publisher: FeedbackPublisher | null): void {
	publishInvitation = publisher;
	if (publisher === null) claimedClient = null;
}

export function surveyIsCompleted(id: string, iteration: number): boolean {
	const current = loadState();
	return current.submittedSurveyId === id && current.submittedIteration === iteration;
}

export function completeSurvey(id: string, iteration: number): void {
	if (!id || !isNonNegativeSafeInteger(iteration)) throw new Error("Invalid survey completion");
	const current = loadState();
	saveState({ ...current, submittedSurveyId: id, submittedIteration: iteration });
	claimedClient = null;
}

export function recordAcceptedMessage(clientKey: string): void {
	const current = loadState();
	const next = {
		...current,
		acceptedMessages: addWithinSafeRange(current.acceptedMessages, 1),
	};
	cachedState = next;
	try {
		writeState(next);
	} catch {
		return;
	}
	maybeOffer(clientKey);
	if (surveyRefreshDue()) void refreshInAppSurvey().then(() => maybeOffer(clientKey));
}

function maybeOffer(clientKey: string): void {
	const current = loadState();
	if (
		current.dismissed ||
		!surveyOfferAvailable() ||
		current.acceptedMessages < current.nextInvitationAt ||
		claimedClient !== null
	) {
		return;
	}
	claimedClient = clientKey;
	deliverInvitation(clientKey);
}

function surveyOfferAvailable(): boolean {
	const survey = currentInAppSurvey();
	return survey !== null && !surveyIsCompleted(survey.id, survey.iteration);
}

function deliverInvitation(clientKey: string): void {
	try {
		if (publishInvitation?.(clientKey) !== true) claimedClient = null;
	} catch {
		claimedClient = null;
	}
}

export function redeliverInvitation(clientKey: string): void {
	if (claimedClient === clientKey) deliverInvitation(clientKey);
}

export function respondToInvitation(action: SurveyInvitationResponse): void {
	const current = loadState();
	let next: FeedbackState;
	switch (action) {
		case "postpone":
			next = {
				...current,
				nextInvitationAt: addWithinSafeRange(current.acceptedMessages, INVITATION_INTERVAL),
			};
			break;
		case "never":
			next = { ...current, dismissed: true };
			break;
		default:
			throw new Error("Invalid invitation response");
	}
	saveState(next);
	claimedClient = null;
}

export function releaseInvitation(clientKey: string): void {
	if (claimedClient === clientKey) claimedClient = null;
}

export function resetFeedbackForTests(): void {
	cachedState = null;
	claimedClient = null;
	publishInvitation = null;
}
