import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	completeSurvey,
	recordAcceptedMessage,
	redeliverInterview,
	releaseInterview,
	resetFeedbackForTests,
	respondToInterview,
	setFeedbackPublisher,
	setSurveyOffer,
	surveyIsCompleted,
} from "./feedback";

interface StoredFeedback {
	acceptedMessages: number;
	nextInvitationAt: number;
	dismissed: boolean;
	submittedSurveyId: string | null;
	submittedIteration: number | null;
}

function feedback(overrides: Partial<StoredFeedback> = {}): StoredFeedback {
	return {
		acceptedMessages: 0,
		nextInvitationAt: 10,
		dismissed: false,
		submittedSurveyId: null,
		submittedIteration: null,
		...overrides,
	};
}

let directory: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function stored(): StoredFeedback {
	return JSON.parse(readFileSync(join(directory, "feedback.json"), "utf8")) as StoredFeedback;
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-feedback-test-"));
	process.env.THINKRAIL_DATA_DIR = directory;
	resetFeedbackForTests();
	setSurveyOffer(() => true);
});

afterEach(() => {
	resetFeedbackForTests();
	rmSync(directory, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("missing and malformed state use the complete defaults", () => {
	respondToInterview("postpone");
	expect(stored()).toEqual(feedback());

	for (const malformed of [
		"{not json",
		JSON.stringify({ acceptedMessages: -1, nextInvitationAt: 10, dismissed: false }),
		JSON.stringify({ acceptedMessages: 0.5, nextInvitationAt: 10, dismissed: false }),
		JSON.stringify({
			acceptedMessages: 0,
			nextInvitationAt: Number.MAX_SAFE_INTEGER + 1,
			dismissed: false,
		}),
		JSON.stringify({ acceptedMessages: 0, nextInvitationAt: 10, dismissed: "false" }),
	]) {
		writeFileSync(join(directory, "feedback.json"), malformed);
		resetFeedbackForTests();
		recordAcceptedMessage("client-a");
		expect(stored()).toEqual(feedback({ acceptedMessages: 1 }));
	}
});

test("a failed atomic replacement preserves durable state and cleans its temporary path", () => {
	respondToInterview("never");
	const durable = stored();
	const temporary = join(directory, `feedback.json.${process.pid}.tmp`);
	mkdirSync(temporary);

	expect(() => respondToInterview("postpone")).toThrow();
	expect(stored()).toEqual(durable);
	expect(existsSync(temporary)).toBe(false);
});

test("accepted messages persist synchronously and one client holds the eligible claim", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});

	for (let count = 0; count < 9; count += 1) recordAcceptedMessage("client-a");
	expect(delivered).toEqual([]);
	expect(stored().acceptedMessages).toBe(9);

	recordAcceptedMessage("client-a");
	expect(delivered).toEqual(["client-a"]);
	recordAcceptedMessage("client-b");
	releaseInterview("client-b");
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	expect(stored().acceptedMessages).toBe(12);

	releaseInterview("client-a");
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a", "client-b"]);
	expect(stored().acceptedMessages).toBe(13);
});

test("postpone schedules ten additional accepted messages and clears the claim", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");

	respondToInterview("postpone");
	expect(stored()).toEqual(feedback({ acceptedMessages: 10, nextInvitationAt: 20 }));
	for (let count = 0; count < 9; count += 1) recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a", "client-b"]);
});

test("book and never record dismissal without stopping later survey counting", () => {
	for (const action of ["book", "never"] as const) {
		rmSync(join(directory, "feedback.json"), { force: true });
		resetFeedbackForTests();
		setSurveyOffer(() => true);
		recordAcceptedMessage("client-a");
		respondToInterview(action);
		expect(stored()).toEqual(feedback({ acceptedMessages: 1, dismissed: true }));

		resetFeedbackForTests();
		setSurveyOffer(() => true);
		recordAcceptedMessage("client-b");
		expect(stored()).toEqual(feedback({ acceptedMessages: 2, dismissed: true }));
	}
});

test("don't ask again keeps counting but does not offer the usage prompt again", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");
	expect(delivered).toEqual(["client-a"]);
	respondToInterview("never");
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	expect(stored()).toEqual(feedback({ acceptedMessages: 20, dismissed: true }));
});

test("failed delivery and process-local reset release eligible claims", () => {
	const attempts: string[] = [];
	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return false;
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");

	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return true;
	});
	recordAcceptedMessage("client-b");
	expect(attempts).toEqual(["client-a", "client-b"]);

	resetFeedbackForTests();
	setSurveyOffer(() => true);
	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return true;
	});
	recordAcceptedMessage("client-c");
	expect(attempts).toEqual(["client-a", "client-b", "client-c"]);
	expect(stored()).toEqual(feedback({ acceptedMessages: 12 }));
});

test("a throwing publisher releases the claim without losing the accepted count", () => {
	setFeedbackPublisher(() => {
		throw new Error("socket closed");
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");
	expect(stored().acceptedMessages).toBe(10);

	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-b"]);
});

test("count persistence failure preserves an existing claim and cannot reject a product send", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");

	const blockedDataDir = join(directory, "not-a-directory");
	writeFileSync(blockedDataDir, "blocked");
	process.env.THINKRAIL_DATA_DIR = blockedDataDir;
	expect(() => recordAcceptedMessage("client-b")).not.toThrow();

	process.env.THINKRAIL_DATA_DIR = directory;
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	expect(stored().acceptedMessages).toBe(12);
});

test("a failed threshold write is retained and offered after persistence recovers", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	for (let count = 0; count < 9; count += 1) recordAcceptedMessage("client-a");

	const blockedDataDir = join(directory, "not-a-directory");
	writeFileSync(blockedDataDir, "blocked");
	process.env.THINKRAIL_DATA_DIR = blockedDataDir;
	recordAcceptedMessage("client-a");
	expect(delivered).toEqual([]);

	process.env.THINKRAIL_DATA_DIR = directory;
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-b"]);
	expect(stored().acceptedMessages).toBe(11);
});

test("reconnect redelivers only to the claimed client and releases a failed redelivery", () => {
	const attempts: string[] = [];
	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return true;
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");

	redeliverInterview("client-b");
	redeliverInterview("client-a");
	expect(attempts).toEqual(["client-a", "client-a"]);

	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return false;
	});
	redeliverInterview("client-a");
	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return true;
	});
	recordAcceptedMessage("client-b");
	expect(attempts).toEqual(["client-a", "client-a", "client-a", "client-b"]);
});

test("invalid responses do not mutate state or release the claim", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");

	expect(() => respondToInterview("later" as "postpone")).toThrow("Invalid interview response");
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	expect(stored()).toEqual(feedback({ acceptedMessages: 11 }));
});

test("an old feedback file without survey completion still counts", () => {
	writeFileSync(
		join(directory, "feedback.json"),
		JSON.stringify({ acceptedMessages: 4, nextInvitationAt: 10, dismissed: true }),
	);
	resetFeedbackForTests();
	setSurveyOffer(() => true);
	recordAcceptedMessage("client-a");
	expect(stored()).toEqual(
		feedback({ acceptedMessages: 5, nextInvitationAt: 10, dismissed: true }),
	);
});

test("a survey offer is required before the usage prompt, and completion is per id and iteration", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	setSurveyOffer(() => false);
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");
	expect(delivered).toEqual([]);

	setSurveyOffer(() => !surveyIsCompleted("survey-1", 1));
	recordAcceptedMessage("client-a");
	expect(delivered).toEqual(["client-a"]);

	completeSurvey("survey-1", 1);
	expect(surveyIsCompleted("survey-1", 1)).toBe(true);
	expect(surveyIsCompleted("survey-1", 2)).toBe(false);
	releaseInterview("client-a");
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);

	setSurveyOffer(() => !surveyIsCompleted("survey-2", 0));
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a", "client-b"]);
	expect(stored()).toEqual(
		feedback({
			acceptedMessages: 13,
			submittedSurveyId: "survey-1",
			submittedIteration: 1,
		}),
	);
});

test("a malformed survey completion resets the file to the defaults", () => {
	writeFileSync(
		join(directory, "feedback.json"),
		JSON.stringify({
			acceptedMessages: 3,
			nextInvitationAt: 10,
			dismissed: false,
			submittedSurveyId: 4,
			submittedIteration: 1,
		}),
	);
	resetFeedbackForTests();
	setSurveyOffer(() => true);
	recordAcceptedMessage("client-a");
	expect(stored()).toEqual(feedback({ acceptedMessages: 1 }));
});
