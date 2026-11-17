import { expect, test } from "bun:test";
import {
	DEFAULT_PR_BABYSIT_CONFIG,
	type PrBabysitItem,
	type PrBabysitSessionState,
} from "@thinkrail/contracts";
import { isOpenPrBabysitItem, prBabysitCounts } from "../../store";
import { prBabysitItemActions } from "./prBabysitLabels";

function item(patch: Partial<PrBabysitItem>): PrBabysitItem {
	return {
		itemId: "i",
		source: "independent_review",
		itemType: "finding",
		summary: "s",
		status: "pending_review_approval",
		updatedAt: 0,
		...patch,
	};
}

test("a pending finding offers fix, post and dismiss", () => {
	expect(prBabysitItemActions(item({}))).toEqual(["fix", "post", "dismiss"]);
	expect(prBabysitItemActions(item({ postedToGithub: true }))).toEqual(["fix", "dismiss"]);
});

test("a staged fix offers diff, approve & push, retry and dismiss", () => {
	expect(
		prBabysitItemActions(
			item({ source: "github_thread", status: "needs_human", commitSha: "abc1234def" }),
		),
	).toEqual(["openDiff", "approvePush", "retry", "dismiss"]);
});

test("a failed fix without a commit can only be retried or dismissed", () => {
	expect(
		prBabysitItemActions(item({ source: "ci_check", status: "needs_human", errorMessage: "x" })),
	).toEqual(["retry", "dismiss"]);
	expect(prBabysitItemActions(item({ source: "ci_check", status: "working" }))).toEqual([]);
});

test("counts are active fixes and open findings", () => {
	const session: PrBabysitSessionState = {
		workspaceId: "w",
		owner: "o",
		repo: "r",
		prNumber: 1,
		headRefName: "f",
		baseRefName: "m",
		active: true,
		status: "watching",
		config: DEFAULT_PR_BABYSIT_CONFIG,
		cycleCount: 0,
		reviewing: false,
		updatedAt: 0,
		items: [
			item({ status: "pending_review_approval" }),
			item({ status: "queued" }),
			item({ source: "github_thread", status: "working" }),
			item({ status: "dismissed" }),
			item({ source: "ci_check", status: "pushed" }),
		],
	};
	expect(prBabysitCounts(session)).toEqual({ fixes: 2, findings: 2 });
	expect(prBabysitCounts(null)).toEqual({ fixes: 0, findings: 0 });
	expect(session.items.filter(isOpenPrBabysitItem)).toHaveLength(3);
});
