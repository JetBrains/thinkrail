import { createHash } from "node:crypto";
import type { IssueProvider } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { isSafeRef } from "../git";
import type { IssueDeliveryRemote } from "../issues";

export interface IssueDependencyRepository {
	projectId: string;
	provider: IssueProvider;
	instanceUrl: string;
	remoteProjectId: number;
	targetBranch: string;
	/** Exact upstream request to inspect, never inferred from a source branch or CI. */
	mergeRequestIid?: number;
	dependsOn: readonly string[];
}
export type IssueCompatibilityStatus = "passed" | "failed" | "not-applicable" | "unknown";
export interface IssueCompatibilityEvidence {
	/** Independent repository CI is deliberately not cross-repository proof. */
	kind: "cross-repository" | "independent-ci";
	downstreamSha: string;
	downstreamTree: string;
	upstreamProjectId: string;
	upstreamMergeSha: string;
	api: IssueCompatibilityStatus;
	abi: IssueCompatibilityStatus;
	protocol: IssueCompatibilityStatus;
	conflict: IssueCompatibilityStatus;
	checks: IssueCompatibilityStatus;
	/** Host-verified evidence identity, e.g. an immutable test/report digest. */
	snapshot: string;
}
export interface IssueDependencyMerge {
	projectId: string;
	provider: IssueProvider;
	instanceUrl: string;
	remoteProjectId: number;
	iid: number;
	targetBranch: string;
	mergeCommitSha: string;
	targetSha: string;
	snapshot: string;
}
export interface IssueDependencyPairingReceipt {
	version: 1;
	projectId: string;
	downstreamSha: string;
	downstreamTree: string;
	/** Ancestors in delivery order, carrying actual provider merge and target SHAs. */
	upstreams: IssueDependencyMerge[];
	compatibility: IssueCompatibilityEvidence[];
	snapshot: string;
}
export interface IssueRepositoryDependenciesOptions {
	repositories: readonly IssueDependencyRepository[];
	/** Host must resolve the exact live provider/instance/project binding on every call. */
	remoteFor(repository: IssueDependencyRepository): Promise<{
		provider: IssueProvider;
		instanceUrl: string;
		remote: Pick<
			IssueDeliveryRemote,
			"project" | "mergeRequest" | "mergeEvidence" | "targetBranchSha"
		>;
	}>;
	/** Actual owned checkout HEAD and final tree, including any lock pairing edits. */
	checkout(projectId: string): Promise<{ sha: string; tree: string }>;
	/** Trusted host evidence reader; agent assertions and independent CI are insufficient. */
	compatibility(input: {
		projectId: string;
		downstreamSha: string;
		downstreamTree: string;
		upstream: IssueDependencyMerge;
	}): Promise<IssueCompatibilityEvidence | null>;
}
function refuse(reason: string): never {
	throw new CodedError(
		"ISSUE_DELIVERY_REFUSED",
		`Repository dependency preflight refused (${reason}).`,
	);
}
function oid(value: unknown): value is string {
	return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}
function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Read-only gate. The host may journal its receipt as a completed read-only confirmation
 * operation. It writes no lockfile, store, runtime, Git state or remote resource.
 * Run preflight before automatic delivery/pairing. After pairing changes the tree, obtain
 * fresh compatibility evidence and a new preflight receipt for that final tree; revalidate
 * that receipt immediately before delivery. Observations are not a distributed Git lock. */
export function createIssueRepositoryDependencies(options: IssueRepositoryDependenciesOptions) {
	const repositories = options.repositories.map((entry) => ({
		...entry,
		dependsOn: [...entry.dependsOn],
	}));
	const byId = new Map(repositories.map((entry) => [entry.projectId, entry]));
	if (byId.size !== repositories.length) refuse("duplicate-repository");
	for (const entry of repositories) {
		if (
			!entry.projectId ||
			!isSafeRef(entry.targetBranch) ||
			!Number.isSafeInteger(entry.remoteProjectId) ||
			entry.remoteProjectId <= 0 ||
			(entry.provider !== "github" && entry.provider !== "gitlab")
		)
			refuse("invalid-repository");
		if (new Set(entry.dependsOn).size !== entry.dependsOn.length) refuse("duplicate-dependency");
		if (entry.dependsOn.some((id) => !byId.has(id))) refuse("unknown-dependency");
	}
	const order: string[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();
	function visit(id: string) {
		if (visiting.has(id)) refuse("dependency-cycle");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const upstream of byId.get(id)?.dependsOn ?? []) visit(upstream);
		visiting.delete(id);
		visited.add(id);
		order.push(id);
	}
	for (const entry of repositories) visit(entry.projectId);

	async function merged(entry: IssueDependencyRepository): Promise<IssueDependencyMerge> {
		const iid = entry.mergeRequestIid;
		if (!iid || !Number.isSafeInteger(iid) || iid <= 0) refuse("missing-upstream-request");
		const access = await options.remoteFor({ ...entry, dependsOn: [...entry.dependsOn] });
		if (access.provider !== entry.provider || access.instanceUrl !== entry.instanceUrl)
			refuse("upstream-binding-changed");
		const remote = access.remote;
		if ((await remote.project()).id !== entry.remoteProjectId) refuse("upstream-binding-changed");
		if (!remote.mergeEvidence) refuse("merge-evidence-unavailable");
		const request = await remote.mergeRequest(iid);
		if (
			request.iid !== iid ||
			request.state !== "merged" ||
			!request.mergeCommitSha ||
			request.targetBranch !== entry.targetBranch ||
			request.targetProjectId !== entry.remoteProjectId
		)
			refuse("upstream-request-mismatch");
		const evidence = await remote.mergeEvidence(iid);
		if (
			evidence.iid !== iid ||
			evidence.targetBranch !== entry.targetBranch ||
			evidence.relationship !== "ancestor" ||
			!oid(evidence.mergeCommitSha) ||
			!oid(evidence.targetSha) ||
			!evidence.snapshot ||
			request.mergeCommitSha !== evidence.mergeCommitSha
		)
			refuse("upstream-merge-unproven");
		if ((await remote.targetBranchSha(entry.targetBranch)) !== evidence.targetSha)
			refuse("upstream-target-changed");
		return {
			projectId: entry.projectId,
			provider: entry.provider,
			instanceUrl: entry.instanceUrl,
			remoteProjectId: entry.remoteProjectId,
			iid,
			targetBranch: entry.targetBranch,
			mergeCommitSha: evidence.mergeCommitSha,
			targetSha: evidence.targetSha,
			snapshot: evidence.snapshot,
		};
	}
	async function preflight(projectId: string): Promise<IssueDependencyPairingReceipt> {
		const entry = byId.get(projectId);
		if (!entry) refuse("unknown-repository");
		const checkout = await options.checkout(projectId);
		if (!oid(checkout.sha) || !oid(checkout.tree)) refuse("checkout-unavailable");
		const ancestors = new Set<string>();
		function collect(id: string) {
			for (const upstream of byId.get(id)?.dependsOn ?? []) {
				if (ancestors.has(upstream)) continue;
				ancestors.add(upstream);
				collect(upstream);
			}
		}
		collect(projectId);
		const upstreams: IssueDependencyMerge[] = [];
		for (const id of order) {
			if (!ancestors.has(id)) continue;
			const upstream = byId.get(id);
			if (!upstream) refuse("unknown-dependency");
			upstreams.push(await merged(upstream));
		}
		const compatibility: IssueCompatibilityEvidence[] = [];
		for (const upstream of upstreams) {
			const evidence = await options.compatibility({
				projectId,
				downstreamSha: checkout.sha,
				downstreamTree: checkout.tree,
				upstream: structuredClone(upstream),
			});
			if (evidence?.kind !== "cross-repository") refuse("compatibility-missing");
			if (
				evidence.downstreamSha !== checkout.sha ||
				evidence.downstreamTree !== checkout.tree ||
				evidence.upstreamProjectId !== upstream.projectId ||
				evidence.upstreamMergeSha !== upstream.mergeCommitSha
			)
				refuse("compatibility-stale");
			if (
				!evidence.snapshot ||
				[evidence.api, evidence.abi, evidence.protocol, evidence.conflict, evidence.checks].some(
					(status) => status !== "passed" && status !== "not-applicable",
				)
			)
				refuse("compatibility-unproven");
			compatibility.push(structuredClone(evidence));
		}
		const finalCheckout = await options.checkout(projectId);
		if (finalCheckout.sha !== checkout.sha || finalCheckout.tree !== checkout.tree)
			refuse("checkout-changed");
		// Bracket compatibility reads with fresh provider observations as well as checkout reads.
		for (const upstreamMerge of upstreams) {
			const upstream = byId.get(upstreamMerge.projectId);
			if (!upstream || digest(await merged(upstream)) !== digest(upstreamMerge))
				refuse("upstream-changed");
		}
		const receipt = {
			version: 1 as const,
			projectId,
			downstreamSha: checkout.sha,
			downstreamTree: checkout.tree,
			upstreams,
			compatibility,
		};
		return { ...receipt, snapshot: digest(receipt) };
	}
	return {
		/** Deterministic upstream-first order, isolated from internal configuration. */
		order: [...order],
		preflight,
		async revalidate(
			receipt: IssueDependencyPairingReceipt,
		): Promise<IssueDependencyPairingReceipt> {
			const fresh = await preflight(receipt.projectId);
			if (digest(fresh) !== digest(receipt)) refuse("evidence-snapshot-changed");
			return fresh;
		},
	};
}
