import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	recordAcceptedMessage,
	releaseInterview,
	resetFeedbackForTests,
	respondToInterview,
	setFeedbackPublisher,
} from "./feedback";

interface StoredFeedback {
	acceptedMessages: number;
	nextInvitationAt: number;
	dismissed: boolean;
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
});

afterEach(() => {
	resetFeedbackForTests();
	rmSync(directory, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("missing and malformed state use the complete defaults", () => {
	respondToInterview("postpone");
	expect(stored()).toEqual({ acceptedMessages: 0, nextInvitationAt: 10, dismissed: false });

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
		expect(stored()).toEqual({ acceptedMessages: 1, nextInvitationAt: 10, dismissed: false });
	}
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
	expect(stored()).toEqual({ acceptedMessages: 10, nextInvitationAt: 20, dismissed: false });
	for (let count = 0; count < 9; count += 1) recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a", "client-b"]);
});

test("book and never persist permanent dismissal and stop counting", () => {
	for (const action of ["book", "never"] as const) {
		rmSync(join(directory, "feedback.json"), { force: true });
		resetFeedbackForTests();
		recordAcceptedMessage("client-a");
		respondToInterview(action);
		const dismissed = stored();
		expect(dismissed).toEqual({ acceptedMessages: 1, nextInvitationAt: 10, dismissed: true });

		resetFeedbackForTests();
		recordAcceptedMessage("client-b");
		expect(stored()).toEqual(dismissed);
	}
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
	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return true;
	});
	recordAcceptedMessage("client-c");
	expect(attempts).toEqual(["client-a", "client-b", "client-c"]);
	expect(stored()).toEqual({ acceptedMessages: 12, nextInvitationAt: 10, dismissed: false });
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
	expect(stored()).toEqual({ acceptedMessages: 11, nextInvitationAt: 10, dismissed: false });
});
