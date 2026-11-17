import { expect, test } from "bun:test";
import {
	DEFAULT_PR_BABYSIT_CONFIG,
	type PrBabysitConfig,
	type PrBabysitEventKind,
} from "@thinkrail/contracts";
import type { GhRunner } from "./github";
import { createPrBabysitStore } from "./store";
import {
	type BabysitAgent,
	createBabysitEngine,
	type GitRunner,
	hunkAround,
	replyBody,
} from "./watcher";

interface Fake {
	threads: unknown[];
	checks: unknown[];
	state: string;
	head: string;
	findings: string;
	verdict: string;
	replies: string[];
	resolved: string[];
	reviews: string[];
	pushes: number;
	fixes: string[];
	reviewerTools: string[][];
}

function prResponse(fake: Fake) {
	return JSON.stringify({
		data: {
			repository: {
				pullRequest: {
					number: 3,
					state: fake.state,
					baseRefName: "main",
					headRefName: "feat",
					headRefOid: fake.head,
					reviewThreads: { nodes: fake.threads },
					commits: {
						nodes: [
							{
								commit: {
									statusCheckRollup: { state: "SUCCESS", contexts: { nodes: fake.checks } },
								},
							},
						],
					},
				},
			},
		},
	});
}

function harness(config: Partial<PrBabysitConfig> = {}) {
	const fake: Fake = {
		threads: [],
		checks: [],
		state: "OPEN",
		head: "h1",
		findings: "```json\n[]\n```",
		verdict: '```json\n{"verdict":"approve"}\n```',
		replies: [],
		resolved: [],
		reviews: [],
		pushes: 0,
		fixes: [],
		reviewerTools: [],
	};
	let dirty = false;
	let headSha = "base000";
	const gh: GhRunner = async (_cwd, args, options) => {
		if (args[0] === "api" && args[1] === "user") return { ok: true, out: "me", err: "" };
		if (args[1] === "graphql" && args[3]?.startsWith("query=query"))
			return { ok: true, out: prResponse(fake), err: "" };
		if (args[1] === "graphql") {
			fake.resolved.push(args.at(-1) ?? "");
			return { ok: true, out: "{}", err: "" };
		}
		if (args[1]?.endsWith("/replies")) {
			fake.replies.push(args.at(-1) ?? "");
			return { ok: true, out: "{}", err: "" };
		}
		if (args.includes("--input")) {
			fake.reviews.push(options?.stdin ?? "");
			return { ok: true, out: "{}", err: "" };
		}
		return { ok: false, out: "", err: `unexpected gh ${args.join(" ")}` };
	};
	const git: GitRunner = async (_cwd, args) => {
		const [command] = args;
		if (command === "status") return { ok: true, out: dirty ? " M a.ts" : "" };
		if (command === "rev-parse" && args[1] === "--abbrev-ref") return { ok: true, out: "feat" };
		if (command === "rev-parse") return { ok: true, out: headSha };
		if (command === "commit") {
			dirty = false;
			headSha = `fix${fake.fixes.length}abcdef`;
			return { ok: true, out: "" };
		}
		if (command === "push") {
			fake.pushes++;
			return { ok: true, out: "" };
		}
		if (command === "log")
			return { ok: true, out: args[2] === "--format=%b" ? "Added a guard." : "subject" };
		return { ok: true, out: "" };
	};
	const agent: BabysitAgent = {
		ensureChat: async () => "chat-1",
		runFix: async (_session, prompt) => {
			fake.fixes.push(prompt);
			dirty = true;
			return "Added a guard.";
		},
		runReviewer: async (input) => {
			fake.reviewerTools.push(input.tools);
			return {
				text: input.task.includes("## The fix") ? fake.verdict : fake.findings,
				model: "anthropic/reviewer",
			};
		},
	};
	let saved: unknown = null;
	const backend = {
		load: () => saved,
		save: (value: unknown) => {
			saved = value;
		},
	};
	const events: PrBabysitEventKind[] = [];
	const makeEngine = () =>
		createBabysitEngine({
			store: createPrBabysitStore(backend),
			gh,
			git,
			agent,
			worktreeOf: () => "/wt",
			readFile: () => null,
			publish: (event) => events.push(event.kind),
			schedule: () => () => {},
			now: () => Date.now(),
		});
	const engine = makeEngine();
	const start = () =>
		engine.start({
			workspaceId: "w",
			owner: "o",
			repo: "r",
			prNumber: 3,
			config: { ...DEFAULT_PR_BABYSIT_CONFIG, ...config },
		});
	return { fake, engine, makeEngine, start, events };
}

async function until(check: () => boolean, label: string) {
	for (let i = 0; i < 200; i++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error(`timed out waiting for ${label}`);
}

const humanThread = {
	id: "T1",
	isResolved: false,
	isOutdated: false,
	path: "a.ts",
	line: 2,
	comments: {
		nodes: [{ id: "C1", databaseId: 11, author: { login: "bob" }, body: "guard x", createdAt: "" }],
	},
};

test("auto_push fixes a thread, pushes, replies with the sha, resolves, and counts the cycle", async () => {
	const h = harness({ mode: "auto_push", autoResolveThreads: true, independentReviewMode: "off" });
	h.fake.threads = [humanThread];
	await h.start();
	await until(() => h.fake.replies.length === 1, "reply");
	await until(() => h.engine.get("w")?.items[0]?.status === "resolved", "resolved");
	expect(h.fake.pushes).toBe(1);
	expect(h.fake.replies[0]).toBe(`body=${replyBody("fix1abc", "Added a guard.")}`);
	expect(h.fake.resolved).toEqual(["threadId=T1"]);
	expect(h.engine.get("w")?.cycleCount).toBe(1);
	expect(h.fake.fixes[0]).toContain("guard x");
	expect(h.events).toContain("item_working");
	expect(h.events).toContain("item_pushed");
});

test("a restart re-polls without answering a thread twice", async () => {
	const h = harness({ mode: "auto_push", independentReviewMode: "off" });
	h.fake.threads = [humanThread];
	await h.start();
	await until(() => h.engine.get("w")?.items[0]?.status === "pushed", "pushed");
	h.engine.dispose();
	h.fake.threads = [
		{
			...humanThread,
			comments: {
				nodes: [
					...humanThread.comments.nodes,
					{
						id: "C2",
						databaseId: 12,
						author: { login: "me" },
						body: "[helios-babysit] Fixed",
						createdAt: "",
					},
				],
			},
		},
	];
	const restarted = h.makeEngine();
	restarted.resume();
	await restarted.tick("w");
	expect(h.fake.replies).toHaveLength(1);
	expect(h.fake.fixes).toHaveLength(1);
	restarted.dispose();
});

test("stage_for_approval commits locally and waits for Approve & Push", async () => {
	const h = harness({ mode: "stage_for_approval", independentReviewMode: "off" });
	h.fake.threads = [humanThread];
	await h.start();
	await until(() => h.engine.get("w")?.items[0]?.status === "needs_human", "staged");
	expect(h.fake.pushes).toBe(0);
	const item = h.engine.get("w")?.items[0];
	expect(item?.commitSha).toBe("fix1abcdef");
	await h.engine.approvePush("w", item?.itemId ?? "");
	expect(h.fake.pushes).toBe(1);
	expect(h.fake.replies).toHaveLength(1);
	expect(h.engine.get("w")?.items[0]?.status).toBe("pushed");
	expect(h.engine.get("w")?.cycleCount).toBe(0);
	h.engine.dispose();
});

test("the cycle cap stops autonomous pushes", async () => {
	const h = harness({ mode: "auto_push", independentReviewMode: "off", maxPushCycles: 1 });
	h.fake.checks = [{ __typename: "CheckRun", name: "test", conclusion: "FAILURE" }];
	await h.start();
	await until(() => h.fake.pushes === 1, "first push");
	h.fake.head = "h2";
	await h.engine.tick("w");
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(h.fake.pushes).toBe(1);
	expect(h.engine.get("w")?.status).toBe("needs_human");
	h.engine.dispose();
});

test("the independent reviewer files findings read-only and rejects a bad patch", async () => {
	const h = harness({ mode: "auto_push", independentReviewMode: "review_and_auto_queue" });
	h.fake.findings =
		'```json\n[{"path":"a.ts","line":2,"severity":"blocker","summary":"x can be null"},{"severity":"suggestion","summary":"rename"}]\n```';
	h.fake.verdict = '```json\n{"verdict":"reject","reason":"touches tests"}\n```';
	await h.start();
	await until(
		() => h.engine.get("w")?.items.some((item) => item.status === "needs_human") === true,
		"rejected fix",
	);
	const items = h.engine.get("w")?.items ?? [];
	const blocker = items.find((item) => item.severity === "blocker");
	expect(blocker?.errorMessage).toContain("touches tests");
	expect(blocker?.reviewerModel).toBe("anthropic/reviewer");
	expect(items.find((item) => item.severity === "suggestion")?.status).toBe(
		"pending_review_approval",
	);
	expect(h.engine.get("w")?.lastReviewedOid).toBe("h1");
	expect(h.fake.pushes).toBe(0);
	for (const tools of h.fake.reviewerTools) expect(tools).not.toContain("bash");
	expect(h.events).toContain("reviewer_started");
	expect(h.events).toContain("finding_created");
	h.engine.dispose();
});

test("post_to_github submits a tagged review and marks the findings posted", async () => {
	const h = harness({ independentReviewMode: "post_to_github" });
	h.fake.findings =
		'```json\n[{"path":"a.ts","line":2,"severity":"warning","summary":"leak"}]\n```';
	await h.start();
	await until(() => h.fake.reviews.length === 1, "review posted");
	await until(() => h.engine.get("w")?.items[0]?.postedToGithub === true, "posted flag");
	const payload = JSON.parse(h.fake.reviews[0] ?? "{}") as { event: string; body: string };
	expect(payload.event).toBe("COMMENT");
	expect(payload.body).toStartWith("[helios-review]");
	h.engine.dispose();
});

test("a merged PR stops the session", async () => {
	const h = harness();
	h.fake.state = "MERGED";
	await h.start();
	await until(() => h.engine.get("w")?.active === false, "stopped");
	expect(h.engine.get("w")?.status).toBe("merged");
});

test("hunkAround starts at the hunk containing the line", () => {
	const diff = ["diff --git a/x b/x", "@@ -1,3 +1,3 @@", " a", "@@ -40,2 +40,4 @@", " target"].join(
		"\n",
	);
	expect(hunkAround(diff, 41).startsWith("@@ -40,2 +40,4 @@")).toBe(true);
	expect(hunkAround("", 3)).toBe("");
});
