import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InterviewResponse } from "@thinkrail/contracts";
import { dataDir } from "../persistence";

interface FeedbackState {
	acceptedMessages: number;
	nextInvitationAt: number;
	dismissed: boolean;
}

type FeedbackPublisher = (clientKey: string) => boolean;

const INVITATION_INTERVAL = 10;
const DEFAULT_STATE: FeedbackState = {
	acceptedMessages: 0,
	nextInvitationAt: INVITATION_INTERVAL,
	dismissed: false,
};

let cachedState: FeedbackState | null = null;
let claimedClient: string | null = null;
let publishInterview: FeedbackPublisher | null = null;

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
	return {
		acceptedMessages: candidate.acceptedMessages,
		nextInvitationAt: candidate.nextInvitationAt,
		dismissed: candidate.dismissed,
	};
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

function saveState(next: FeedbackState): void {
	mkdirSync(dataDir(), { recursive: true });
	writeFileSync(join(dataDir(), "feedback.json"), `${JSON.stringify(next, null, "\t")}\n`);
	cachedState = next;
}

function addWithinSafeRange(value: number, amount: number): number {
	return Math.min(value + amount, Number.MAX_SAFE_INTEGER);
}

export function setFeedbackPublisher(publisher: FeedbackPublisher | null): void {
	publishInterview = publisher;
	if (publisher === null) claimedClient = null;
}

export function recordAcceptedMessage(clientKey: string): void {
	const current = loadState();
	if (current.dismissed) return;
	const next = {
		...current,
		acceptedMessages: addWithinSafeRange(current.acceptedMessages, 1),
	};
	try {
		saveState(next);
	} catch {
		return;
	}
	if (next.acceptedMessages < next.nextInvitationAt || claimedClient !== null) return;

	claimedClient = clientKey;
	try {
		if (publishInterview?.(clientKey) !== true) claimedClient = null;
	} catch {
		claimedClient = null;
	}
}

export function respondToInterview(action: InterviewResponse): void {
	const current = loadState();
	let next: FeedbackState;
	switch (action) {
		case "postpone":
			next = {
				...current,
				nextInvitationAt: addWithinSafeRange(current.acceptedMessages, INVITATION_INTERVAL),
			};
			break;
		case "book":
		case "never":
			next = { ...current, dismissed: true };
			break;
		default:
			throw new Error("Invalid interview response");
	}
	saveState(next);
	claimedClient = null;
}

export function releaseInterview(clientKey: string): void {
	if (claimedClient === clientKey) claimedClient = null;
}

export function resetFeedbackForTests(): void {
	cachedState = null;
	claimedClient = null;
	publishInterview = null;
}
