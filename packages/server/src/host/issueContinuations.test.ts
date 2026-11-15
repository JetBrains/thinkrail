import { afterEach, expect, test } from "bun:test";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	createIssueContinuations,
	type IssueContinuationBlocked,
	type IssueContinuationQuestions,
} from "./issueContinuations";

const refusal = () => new CodedError("ISSUE_DELIVERY_REFUSED", "private provider token");
const originalEnv = process.env.THINKRAIL_ISSUE_CONTINUATIONS;
afterEach(() => {
	if (originalEnv === undefined) delete process.env.THINKRAIL_ISSUE_CONTINUATIONS;
	else process.env.THINKRAIL_ISSUE_CONTINUATIONS = originalEnv;
});
function host(
	verify: (
		session: string,
		receipt: string,
		questions: IssueContinuationQuestions,
	) => Promise<void> = async () => {},
) {
	return createIssueContinuations({ enabled: () => true, verify });
}
async function card(
	service: ReturnType<typeof host>,
	attempt: (continued?: boolean) => Promise<unknown> = async () => {
		throw refusal();
	},
) {
	return (await service.run(
		"session",
		"operation",
		"execute",
		{ operationId: "operation", title: "Original" },
		attempt,
	)) as IssueContinuationBlocked;
}

test("passes successful values through unchanged", async () => {
	const service = host();
	const value = { status: "completed", receipt: 7 };
	expect(await service.run("s", "op", "prepare", {}, async () => value)).toBe(value);
});

test("concurrent approved executions share one attempt and replay the same result", async () => {
	let attempts = 0;
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	const checks: string[] = [];
	const service = host(async (session, receipt) => {
		checks.push(`${session}/${receipt}`);
	});
	const result = { status: "completed" };
	const blocked = await card(service, async () => {
		if (++attempts === 1) throw refusal();
		await wait;
		return result;
	});
	const first = service.execute("session", "operation", blocked.continuationId, "real-receipt");
	const second = service.execute("session", "operation", blocked.continuationId, "real-receipt");
	await Promise.resolve();
	await Promise.resolve();
	release();
	expect(await first).toBe(result);
	expect(await second).toBe(result);
	expect(
		await service.execute("session", "operation", blocked.continuationId, "real-receipt"),
	).toBe(result);
	expect(attempts).toBe(2);
	expect(checks).toHaveLength(3);
});

test("foreign session, operation, host and unknown ids never verify or attempt", async () => {
	let calls = 0;
	let verifies = 0;
	const service = host(async () => {
		verifies++;
	});
	const blocked = await card(service, async () => {
		calls++;
		throw refusal();
	});
	for (const [session, operation, id] of [
		["foreign", "operation", blocked.continuationId],
		["session", "foreign", blocked.continuationId],
		["session", "operation", "unknown"],
	] as const) {
		await expect(service.execute(session, operation, id, "receipt")).rejects.toHaveProperty(
			"code",
			"RESOURCE_UNAVAILABLE",
		);
	}
	await expect(
		host().execute("session", "operation", blocked.continuationId, "receipt"),
	).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
	expect(verifies).toBe(0);
	expect(calls).toBe(1);
});

test("delegates the exact frozen questions and real tool id; rejected receipts do not claim", async () => {
	let expected: IssueContinuationQuestions;
	let calls = 0;
	const service = host(async (session, receipt, questions) => {
		expect(session).toBe("session");
		expect(questions).toEqual(expected);
		// A verifier cannot alter the stored card either.
		if (questions.questions[0]) questions.questions[0].preview = "tampered";
		if (receipt !== "real-receipt") throw new Error("not an exact Looks right receipt");
	});
	const blocked = await card(service, async () => {
		if (++calls === 1) throw refusal();
		return "done";
	});
	expected = structuredClone(blocked.questions);
	if (blocked.questions.questions[0]) blocked.questions.questions[0].preview = "altered by caller";
	await expect(
		service.execute("session", "operation", blocked.continuationId, "altered-receipt"),
	).rejects.toThrow("not an exact");
	expect(calls).toBe(1);
	expect(
		await service.execute("session", "operation", blocked.continuationId, "real-receipt"),
	).toBe("done");
	expect(calls).toBe(2);
});

test("receipt mismatch never offers a continuation for the same rejected authorization", async () => {
	const service = host();
	const error = Object.assign(
		new CodedError("ISSUE_CONFIRMATION_BLOCKED", "Receipt does not match the frozen card."),
		{ reason: "confirmation_mismatch" },
	);
	let attempts = 0;
	await expect(
		card(service, async () => {
			attempts++;
			throw error;
		}),
	).rejects.toBe(error);
	expect(attempts).toBe(1);
	const blocked = await card(service, async (continued) => {
		if (!continued) throw refusal();
		throw error;
	});
	await expect(
		service.execute("session", "operation", blocked.continuationId, "real-receipt"),
	).rejects.toBe(error);
});

test("sanitizes every thrown failure and recognized code without echoing messages", async () => {
	const service = host();
	for (const error of [
		new Error("SECRET"),
		"SECRET",
		{ code: "ISSUE_DELIVERY_REFUSED", message: "SECRET" },
		new CodedError("RESOURCE_UNAVAILABLE", "SECRET"),
		new CodedError("RANGE_INVALID", "SECRET"),
		new CodedError("ISSUE_CONFIRMATION_BLOCKED", "SECRET"),
		refusal(),
	]) {
		const blocked = await card(service, async () => {
			throw error;
		});
		expect(JSON.stringify(blocked)).not.toContain("SECRET");
		expect(JSON.stringify(blocked)).not.toContain("private provider token");
		expect(blocked.reason.code).toBe(
			error instanceof CodedError &&
				["RANGE_INVALID", "ISSUE_CONFIRMATION_BLOCKED", "ISSUE_DELIVERY_REFUSED"].includes(
					error.code,
				)
				? error.code
				: "RESOURCE_UNAVAILABLE",
		);
	}
});

test("offers cards for structured blocks, including older string reasons", async () => {
	for (const reason of [
		{ code: "ISSUE_DELIVERY_REFUSED", message: "SECRET" },
		"Issue delivery refused [SECRET]. private",
		"Issue confirmation blocked (SECRET).",
		{ code: "UNKNOWN", message: "SECRET" },
	]) {
		const blocked = await card(host(), async () => ({
			status: "blocked",
			reason,
			nextAction: "SECRET",
		}));
		expect(blocked.status).toBe("blocked");
		expect(blocked.continuationId).toBeString();
		expect(JSON.stringify(blocked)).not.toContain("SECRET");
	}
});

test("another refusal produces a separately approved card, without automatically retrying", async () => {
	let calls = 0;
	const service = host();
	const first = await card(service, async () => {
		calls++;
		throw refusal();
	});
	const next = (await service.execute(
		"session",
		"operation",
		first.continuationId,
		"receipt",
	)) as IssueContinuationBlocked;
	expect(next.continuationId).not.toBe(first.continuationId);
	expect(calls).toBe(2);
	expect(await service.execute("session", "operation", first.continuationId, "receipt")).toBe(next);
	expect(calls).toBe(2);
});

test("freezes the original input before awaits and omits credential fields", async () => {
	const service = host();
	const input = {
		title: "Original",
		report: { text: "submitted report", token: "SECRET" },
		credentials: "SECRET",
		apiKey: "SECRET",
	};
	const pending = service.run("session", "operation", "prepare", input, async () => {
		input.title = "Changed";
		throw refusal();
	});
	const blocked = (await pending) as IssueContinuationBlocked;
	const preview = blocked.questions.questions[0]?.preview;
	expect(preview).toContain('"title": "Original"');
	expect(preview).toContain("submitted report");
	expect(preview).not.toContain("SECRET");
	expect(preview).not.toContain("Changed");
	expect(preview).toContain("does not authorize a remote write");
	expect(preview).toContain("separate approval");
	expect(preview).toContain("cannot manufacture credentials");
	expect(blocked.questions.questions[0]?.options.map((item) => item.label)).toEqual([
		"Looks right",
	]);
});

test("bounded previews reject oversized, cyclic and non-JSON input before attempting", async () => {
	let calls = 0;
	const cyclic: { body?: unknown } = {};
	cyclic.body = cyclic;
	for (const input of [{ report: "é".repeat(128 * 1024) }, cyclic, { report: new Date() }]) {
		await expect(
			host().run("s", "op", "prepare", input, async () => {
				calls++;
			}),
		).rejects.toHaveProperty("code", "RANGE_INVALID");
	}
	expect(calls).toBe(0);
});

test("disabled callback and environment pass through failures and structured results without cards", async () => {
	process.env.THINKRAIL_ISSUE_CONTINUATIONS = "0";
	for (const service of [
		createIssueContinuations({ verify: async () => {} }),
		createIssueContinuations({ enabled: () => false, verify: async () => {} }),
	]) {
		const error = refusal();
		await expect(
			service.run("s", "op", "execute", {}, async () => {
				throw error;
			}),
		).rejects.toBe(error);
		const value = { status: "blocked", reason: "original" };
		expect(await service.run("s", "op", "prepare", {}, async () => value)).toBe(value);
		await expect(service.execute("s", "op", "unknown", "receipt")).rejects.toHaveProperty(
			"code",
			"RESOURCE_UNAVAILABLE",
		);
	}
	// An explicit host callback takes precedence over the environment.
	expect((await card(host())).status).toBe("blocked");
});

test("capacity preserves live cards and pending attempts; completed entries can be evicted", async () => {
	const service = host();
	let calls = 0;
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	const first = await card(service, async () => {
		if (++calls === 1) throw refusal();
		await wait;
		return "done";
	});
	const pending = service.execute("session", "operation", first.continuationId, "receipt");
	for (let i = 1; i < 100; i++) await card(service);
	await expect(card(service)).rejects.toThrow("capacity reached");
	release();
	expect(await pending).toBe("done");
	expect((await card(service)).status).toBe("blocked");
	await expect(
		service.execute("session", "operation", first.continuationId, "receipt"),
	).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
});

test("expired cards release capacity and cannot execute", async () => {
	const originalNow = Date.now;
	let now = originalNow();
	Date.now = () => now;
	try {
		const service = host();
		const first = await card(service);
		for (let i = 1; i < 100; i++) await card(service);
		now += 31 * 60 * 1000;
		await expect(
			service.execute("session", "operation", first.continuationId, "receipt"),
		).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		expect((await card(service)).status).toBe("blocked");
	} finally {
		Date.now = originalNow;
	}
});

test("only a verified claimed callback receives the one-shot continuation signal", async () => {
	const signals: boolean[] = [];
	const service = host(async (_session, receipt) => {
		if (receipt !== "real") throw new Error("receipt rejected");
	});
	const blocked = (await service.run("session", "operation", "execute", {}, async (continued) => {
		signals.push(continued === true);
		if (!continued) throw refusal();
		return "done";
	})) as IssueContinuationBlocked;
	await expect(
		service.execute("session", "operation", blocked.continuationId, "fake"),
	).rejects.toThrow();
	expect(signals).toEqual([false]);
	expect(await service.execute("session", "operation", blocked.continuationId, "real")).toBe(
		"done",
	);
	expect(signals).toEqual([false, true]);
});

test("continued flag is false initially and true only after successful verification, including reoffers", async () => {
	const flags: (boolean | undefined)[] = [];
	let release!: () => void;
	const verified = new Promise<void>((resolve) => {
		release = resolve;
	});
	const service = host(async (_session, receipt) => {
		if (receipt === "rejected") throw new Error("rejected receipt");
		await verified;
	});
	const first = await card(service, async (continued) => {
		flags.push(continued);
		throw refusal();
	});
	expect(flags).toEqual([false]);
	await expect(
		service.execute("session", "operation", first.continuationId, "rejected"),
	).rejects.toThrow("rejected receipt");
	expect(flags).toEqual([false]);
	const pending = service.execute("session", "operation", first.continuationId, "accepted");
	await Promise.resolve();
	expect(flags).toEqual([false]);
	release();
	const second = (await pending) as IssueContinuationBlocked;
	expect(flags).toEqual([false, true]);
	await service.execute("session", "operation", second.continuationId, "accepted");
	expect(flags).toEqual([false, true, true]);
});

test("disabled initial attempt explicitly receives false", async () => {
	const service = createIssueContinuations({ enabled: () => false, verify: async () => {} });
	await service.run("session", "operation", "prepare", {}, async (continued) => {
		expect(continued).toBe(false);
	});
});

test("preserves exact host reason tags from coded errors and structured string reasons only", async () => {
	for (const [code, tag] of [
		["ISSUE_DELIVERY_REFUSED", "Issue delivery refused [issue-not-open]."],
		["ISSUE_CONFIRMATION_BLOCKED", "Issue confirmation blocked (uncertain_intent)."],
		["ISSUE_CONFIRMATION_BLOCKED", "Issue stage confirmation refused [stage-snapshot-changed]."],
	] as const) {
		for (const structured of [false, true]) {
			const blocked = await card(host(), async () => {
				if (structured) return { status: "blocked", reason: `${tag} SECRET provider prose` };
				throw new CodedError(code, `${tag} SECRET provider prose`);
			});
			expect(blocked.reason.code).toBe(code);
			expect(blocked.reason.message).toStartWith(tag);
			expect(blocked.questions.questions[0]?.preview).toContain(tag);
			expect(JSON.stringify(blocked)).not.toContain("SECRET");
		}
	}
});

test("does not extract host tags from arbitrary errors, structured message fields or prose", async () => {
	const text = "Issue delivery refused [issue-not-open]. SECRET";
	for (const error of [
		new Error(text),
		{ reason: { code: "ISSUE_DELIVERY_REFUSED", message: text } },
		new CodedError("RESOURCE_UNAVAILABLE", text),
		new CodedError("ISSUE_DELIVERY_REFUSED", `prefix ${text}`),
		{ reason: "Issue delivery refused [arbitrary private prose]. SECRET" },
	]) {
		const blocked = await card(host(), async () => {
			throw error;
		});
		expect(JSON.stringify(blocked)).not.toContain("issue-not-open");
		expect(JSON.stringify(blocked)).not.toContain("arbitrary private prose");
		expect(JSON.stringify(blocked)).not.toContain("SECRET");
	}
});
