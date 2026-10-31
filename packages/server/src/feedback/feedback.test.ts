import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	completeSurvey,
	recordAcceptedMessage,
	redeliverInvitation,
	releaseInvitation,
	resetFeedbackForTests,
	respondToInvitation,
	setFeedbackPublisher,
	surveyIsCompleted,
} from "./feedback";
import {
	configureSurveySource,
	refreshInAppSurvey,
	resetSurveyForTests,
	setSurveyClockForTests,
} from "./survey";

interface StoredFeedback {
	acceptedMessages: number;
	nextInvitationAt: number;
	dismissed: boolean;
	submittedSurveyId: string | null;
	submittedIteration: number | null;
	lastInvitedAt: number | null;
}

function feedback(overrides: Partial<StoredFeedback> = {}): StoredFeedback {
	return {
		acceptedMessages: 0,
		nextInvitationAt: 10,
		dismissed: false,
		submittedSurveyId: null,
		submittedIteration: null,
		lastInvitedAt: null,
		...overrides,
	};
}

async function launch(...surveys: Array<{ id: string; iteration: number }>): Promise<void> {
	const list = surveys.map((survey) => ({
		id: survey.id,
		name: "in-app-feedback",
		start_date: "2026-10-28T00:00:00.000Z",
		current_iteration: survey.iteration,
		questions: [{ id: "q1", type: "open", question: "How is it going?" }],
	}));
	configureSurveySource({
		apiKey: "phc_test",
		fetchImpl: (async () => new Response(JSON.stringify(list))) as unknown as typeof fetch,
	});
	await refreshInAppSurvey();
}

let directory: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function stored(): StoredFeedback {
	return JSON.parse(readFileSync(join(directory, "feedback.json"), "utf8")) as StoredFeedback;
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-feedback-test-"));
	process.env.THINKRAIL_DATA_DIR = directory;
	resetFeedbackForTests();
	await launch({ id: "survey-1", iteration: 1 });
});

afterEach(() => {
	resetFeedbackForTests();
	resetSurveyForTests();
	rmSync(directory, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("missing and malformed state use the complete defaults", () => {
	respondToInvitation("postpone");
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
	respondToInvitation("never");
	const durable = stored();
	const temporary = join(directory, `feedback.json.${process.pid}.tmp`);
	mkdirSync(temporary);

	expect(() => respondToInvitation("postpone")).toThrow();
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
	releaseInvitation("client-b");
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	expect(stored().acceptedMessages).toBe(12);

	releaseInvitation("client-a");
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

	respondToInvitation("postpone");
	expect(stored()).toEqual(
		feedback({ acceptedMessages: 10, nextInvitationAt: 20, lastInvitedAt: expect.any(Number) }),
	);
	for (let count = 0; count < 9; count += 1) recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a", "client-b"]);
});

test("never records dismissal without stopping later counting", () => {
	recordAcceptedMessage("client-a");
	respondToInvitation("never");
	expect(stored()).toEqual(feedback({ acceptedMessages: 1, dismissed: true }));

	resetFeedbackForTests();
	recordAcceptedMessage("client-b");
	expect(stored()).toEqual(feedback({ acceptedMessages: 2, dismissed: true }));
});

test("a legacy dismissal from the interview invitation keeps the survey invitation silent", () => {
	const delivered: string[] = [];
	writeFileSync(
		join(directory, "feedback.json"),
		JSON.stringify({ acceptedMessages: 30, nextInvitationAt: 10, dismissed: true }),
	);
	resetFeedbackForTests();
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	recordAcceptedMessage("client-a");
	expect(delivered).toEqual([]);
});

test("don't ask again keeps counting but does not offer the usage prompt again", () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");
	expect(delivered).toEqual(["client-a"]);
	respondToInvitation("never");
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	expect(stored()).toEqual(
		feedback({ acceptedMessages: 20, dismissed: true, lastInvitedAt: expect.any(Number) }),
	);
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
	expect(stored()).toEqual(feedback({ acceptedMessages: 12, lastInvitedAt: expect.any(Number) }));
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

	redeliverInvitation("client-b");
	redeliverInvitation("client-a");
	expect(attempts).toEqual(["client-a", "client-a"]);

	setFeedbackPublisher((clientKey) => {
		attempts.push(clientKey);
		return false;
	});
	redeliverInvitation("client-a");
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

	expect(() => respondToInvitation("later" as "postpone")).toThrow("Invalid invitation response");
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);
	expect(stored()).toEqual(feedback({ acceptedMessages: 11, lastInvitedAt: expect.any(Number) }));
});

test("an old feedback file without survey completion still counts", () => {
	writeFileSync(
		join(directory, "feedback.json"),
		JSON.stringify({ acceptedMessages: 4, nextInvitationAt: 10, dismissed: true }),
	);
	resetFeedbackForTests();
	recordAcceptedMessage("client-a");
	expect(stored()).toEqual(
		feedback({ acceptedMessages: 5, nextInvitationAt: 10, dismissed: true }),
	);
});

test("a launched, unfinished survey is required before the invitation, per id and iteration", async () => {
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	await launch();
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage("client-a");
	expect(delivered).toEqual([]);

	await launch({ id: "survey-1", iteration: 1 });
	recordAcceptedMessage("client-a");
	expect(delivered).toEqual(["client-a"]);

	completeSurvey("survey-1", 1);
	expect(surveyIsCompleted("survey-1", 1)).toBe(true);
	expect(surveyIsCompleted("survey-1", 2)).toBe(false);
	releaseInvitation("client-a");
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a"]);

	await launch({ id: "survey-1", iteration: 2 });
	recordAcceptedMessage("client-b");
	expect(delivered).toEqual(["client-a", "client-b"]);
	expect(stored()).toEqual(
		feedback({
			acceptedMessages: 13,
			submittedSurveyId: "survey-1",
			submittedIteration: 1,
			lastInvitedAt: expect.any(Number),
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
	recordAcceptedMessage("client-a");
	expect(stored()).toEqual(feedback({ acceptedMessages: 1 }));
});

test("an idle host does not invite from a copy it can no longer refresh", async () => {
	let status = 200;
	let at = 1_000;
	setSurveyClockForTests(() => at);
	configureSurveySource({
		apiKey: "phc_test",
		fetchImpl: (async () =>
			status === 200
				? new Response(
						JSON.stringify([
							{
								id: "survey-1",
								name: "in-app-feedback",
								start_date: "2026-10-28T00:00:00.000Z",
								questions: [{ id: "q1", type: "open", question: "How is it going?" }],
							},
						]),
					)
				: new Response("down", { status })) as unknown as typeof fetch,
	});
	await refreshInAppSurvey();
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	for (let count = 0; count < 9; count += 1) recordAcceptedMessage("client-a");

	status = 503;
	at += 2 * 60 * 60 * 1000;
	recordAcceptedMessage("client-a");
	await Bun.sleep(0);
	await refreshInAppSurvey();
	expect(delivered).toEqual([]);

	status = 200;
	at += 15 * 60 * 1000;
	recordAcceptedMessage("client-a");
	await Bun.sleep(0);
	await refreshInAppSurvey();
	await Bun.sleep(0);
	expect(delivered).toEqual(["client-a"]);
});

test("PostHog's wait period keeps a postponed invitation away for that many days", async () => {
	let at = 1_000_000;
	setSurveyClockForTests(() => at);
	configureSurveySource({
		apiKey: "phc_test",
		fetchImpl: (async () =>
			new Response(
				JSON.stringify([
					{
						id: "survey-1",
						name: "in-app-feedback",
						start_date: "2026-10-28T00:00:00.000Z",
						conditions: { seenSurveyWaitPeriodInDays: 7 },
						questions: [{ id: "q1", type: "open", question: "How is it going?" }],
					},
				]),
			)) as unknown as typeof fetch,
	});
	await refreshInAppSurvey();
	const delivered: string[] = [];
	setFeedbackPublisher((clientKey) => {
		delivered.push(clientKey);
		return true;
	});
	const send = async (count: number) => {
		for (let index = 0; index < count; index += 1) recordAcceptedMessage("client-a");
		await refreshInAppSurvey();
		await Bun.sleep(0);
	};

	await send(10);
	expect(delivered).toEqual(["client-a"]);
	expect(stored().lastInvitedAt).toBe(at);
	respondToInvitation("postpone");

	at += 24 * 60 * 60 * 1000;
	await send(10);
	expect(delivered).toEqual(["client-a"]);

	at += 6 * 24 * 60 * 60 * 1000;
	await send(1);
	expect(delivered).toEqual(["client-a", "client-a"]);
});

test("a malformed invitation time resets the file to the defaults", () => {
	writeFileSync(
		join(directory, "feedback.json"),
		JSON.stringify({
			acceptedMessages: 3,
			nextInvitationAt: 10,
			dismissed: false,
			lastInvitedAt: "x",
		}),
	);
	resetFeedbackForTests();
	recordAcceptedMessage("client-a");
	expect(stored()).toEqual(feedback({ acceptedMessages: 1 }));
});
