import { describe, expect, test } from "bun:test";
import type {
	IssueCompatibilityEvidence,
	IssueDependencyMerge,
	IssueDependencyRepository,
} from "./issueRepositoryDependencies";
import { createIssueRepositoryDependencies } from "./issueRepositoryDependencies";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);
const tree = "d".repeat(40);
const snapshot = "provider-snapshot";
function repo(
	projectId: string,
	dependsOn: string[] = [],
	overrides: Partial<IssueDependencyRepository> = {},
): IssueDependencyRepository {
	return {
		projectId,
		provider: "gitlab",
		instanceUrl: "https://git.example",
		remoteProjectId: projectId.charCodeAt(0),
		targetBranch: "main",
		mergeRequestIid: projectId.charCodeAt(0),
		dependsOn,
		...overrides,
	};
}
function harness(
	repositories: IssueDependencyRepository[],
	opts: {
		relationship?: "ancestor" | "not-ancestor" | "unknown";
		target?: () => string;
		actualRequestTarget?: string;
		compatibility?: (
			merge: IssueDependencyMerge,
			sha: string,
			downstreamTree: string,
		) => IssueCompatibilityEvidence | null;
		checkout?: () => { sha: string; tree: string };
	} = {},
) {
	const observed = new Map<string, string>([
		["a", a],
		["b", b],
		["c", c],
	]);
	const options = {
		repositories,
		remoteFor: async (entry: IssueDependencyRepository) => ({
			provider: entry.provider,
			instanceUrl: entry.instanceUrl,
			remote: {
				project: async () => ({
					id: entry.remoteProjectId,
					pathWithNamespace: "group/repo",
					defaultBranch: "main",
					httpUrlToRepo: null,
					sshUrlToRepo: null,
				}),
				mergeRequest: async (iid: number) => {
					const mergeSha = observed.get(entry.projectId);
					if (!mergeSha) throw new Error("missing fixture merge SHA");
					return {
						iid,
						id: iid,
						webUrl: "https://example/mr",
						state: "merged" as const,
						sourceBranch: "work",
						targetBranch: opts.actualRequestTarget ?? entry.targetBranch,
						sha: "e".repeat(40),
						mergeStatus: "can_be_merged",
						sourceProjectId: entry.remoteProjectId,
						targetProjectId: entry.remoteProjectId,
						draft: false,
						detailedMergeStatus: null,
						mergeCommitSha: mergeSha,
						squashCommitSha: null,
						headPipeline: null,
					};
				},
				mergeEvidence: async (iid: number) => {
					const mergeSha = observed.get(entry.projectId);
					if (!mergeSha) throw new Error("missing fixture merge SHA");
					return {
						iid,
						targetBranch: entry.targetBranch,
						mergeCommitSha: mergeSha,
						targetSha: opts.target?.() ?? "f".repeat(40),
						relationship: opts.relationship ?? "ancestor",
						snapshot,
					};
				},
				targetBranchSha: async () => opts.target?.() ?? "f".repeat(40),
			},
		}),
		checkout: async () => opts.checkout?.() ?? { sha: c, tree },
		compatibility: async (input: {
			upstream: IssueDependencyMerge;
			downstreamSha: string;
			downstreamTree: string;
		}) =>
			opts.compatibility?.(input.upstream, input.downstreamSha, input.downstreamTree) ?? {
				kind: "cross-repository",
				downstreamSha: input.downstreamSha,
				downstreamTree: input.downstreamTree,
				upstreamProjectId: input.upstream.projectId,
				upstreamMergeSha: input.upstream.mergeCommitSha,
				api: "passed",
				abi: "passed",
				protocol: "passed",
				conflict: "passed",
				checks: "passed",
				snapshot: "compatibility-snapshot",
			},
	};
	return { gate: createIssueRepositoryDependencies(options), observed };
}

describe("Issue repository dependency preflight", () => {
	test("orders a three-repository DAG and receipts actual upstream merge SHAs", async () => {
		const { gate } = harness([repo("c", ["b"]), repo("a"), repo("b", ["a"])]);
		expect(gate.order).toEqual(["a", "b", "c"]);
		const receipt = await gate.preflight("c");
		expect(
			receipt.upstreams.map((item) => [item.projectId, item.mergeCommitSha, item.targetSha]),
		).toEqual([
			["a", a, "f".repeat(40)],
			["b", b, "f".repeat(40)],
		]);
		expect(receipt.compatibility).toHaveLength(2);
	});
	test("rejects unknown, duplicate, and cyclic dependency configuration", () => {
		expect(() => harness([repo("a", ["missing"])])).toThrow("unknown-dependency");
		expect(() => harness([repo("a"), repo("a")])).toThrow("duplicate-repository");
		expect(() => harness([repo("a", ["b"]), repo("b", ["a"])])).toThrow("dependency-cycle");
	});
	test("rejects wrong target branch ancestry evidence and does not substitute source SHA", async () => {
		const wrongBranch = harness([repo("a"), repo("b", ["a"])], { actualRequestTarget: "release" });
		await expect(wrongBranch.gate.preflight("b")).rejects.toThrow("upstream-request-mismatch");
		const sourceOnly = harness([repo("a"), repo("b", ["a"])]);
		// The MR's source SHA is e...; the receipt must retain merge evidence a..., not source SHA.
		expect((await sourceOnly.gate.preflight("b")).upstreams[0]?.mergeCommitSha).toBe(a);
	});
	test("rejects stale tree, unknown compatibility, and independent CI as proof", async () => {
		const stale = harness([repo("a"), repo("b", ["a"])], {
			compatibility: (merge) => ({
				kind: "cross-repository",
				downstreamSha: c,
				downstreamTree: "0".repeat(40),
				upstreamProjectId: merge.projectId,
				upstreamMergeSha: merge.mergeCommitSha,
				api: "passed",
				abi: "passed",
				protocol: "passed",
				conflict: "passed",
				checks: "passed",
				snapshot: "s",
			}),
		});
		await expect(stale.gate.preflight("b")).rejects.toThrow("compatibility-stale");
		const unknown = harness([repo("a"), repo("b", ["a"])], {
			compatibility: (merge, sha, downstreamTree) => ({
				kind: "cross-repository",
				downstreamSha: sha,
				downstreamTree,
				upstreamProjectId: merge.projectId,
				upstreamMergeSha: merge.mergeCommitSha,
				api: "unknown",
				abi: "passed",
				protocol: "passed",
				conflict: "passed",
				checks: "passed",
				snapshot: "s",
			}),
		});
		await expect(unknown.gate.preflight("b")).rejects.toThrow("compatibility-unproven");
		const ci = harness([repo("a"), repo("b", ["a"])], {
			compatibility: (merge, sha, downstreamTree) => ({
				kind: "independent-ci",
				downstreamSha: sha,
				downstreamTree,
				upstreamProjectId: merge.projectId,
				upstreamMergeSha: merge.mergeCommitSha,
				api: "passed",
				abi: "passed",
				protocol: "passed",
				conflict: "passed",
				checks: "passed",
				snapshot: "s",
			}),
		});
		await expect(ci.gate.preflight("b")).rejects.toThrow("compatibility-missing");
	});
	test("revalidation detects changed upstream target and returns exact passed receipt", async () => {
		let target = "f".repeat(40);
		const { gate, observed } = harness([repo("a"), repo("b", ["a"])], { target: () => target });
		const receipt = await gate.preflight("b");
		expect(receipt.upstreams[0]?.mergeCommitSha).toBe(a);
		target = "9".repeat(40);
		await expect(gate.revalidate(receipt)).rejects.toThrow("evidence-snapshot-changed");
		observed.set("a", a);
	});
	test("revalidation refuses a downstream worktree changed after preflight", async () => {
		let current = { sha: c, tree };
		const { gate } = harness([repo("a")], { checkout: () => current });
		const receipt = await gate.preflight("a");
		current = { sha: "9".repeat(40), tree: "8".repeat(40) };
		await expect(gate.revalidate(receipt)).rejects.toThrow("evidence-snapshot-changed");
	});
});
