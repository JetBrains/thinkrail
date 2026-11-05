import { createHash } from "node:crypto";
import { type IssueReference, isIssueReference } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	type ApprovalPublication,
	type ApprovalResult,
	type ApprovalStage,
	approvalPublication,
	designVersion,
	implementationVersion,
	tomatoLabels,
	validateApproval,
} from "./approvals";
import type { GitLabClient, GitLabIssue } from "./client";

/** A host-selected live client; credentials never cross this port. */
export type WorkflowRemote = Pick<
	GitLabClient,
	"issue" | "notes" | "labelEvents" | "member" | "currentUser" | "updateIssue" | "addNote"
>;
export interface WorkflowReceipt {
	publication: ApprovalPublication;
	resetConfirmedAbsent: true;
	approved: boolean;
	designVersion?: string;
	commit?: string;
}
export interface WorkflowRecord {
	revision: number;
	design?: WorkflowReceipt;
	implementation?: WorkflowReceipt;
	pending?: {
		operation:
			| "publish-design"
			| "publish-implementation"
			| "approve-design"
			| "approve-implementation";
		version: string;
	};
}
export interface WorkflowPersistence {
	load(reference: IssueReference): Promise<WorkflowRecord | null>;
	/** Atomically and durably replace only at expected revision (absent = 0).
	 * Must serialize all writers for a provider-qualified reference, including across processes.
	 * A rejected/uncertain save must never allow a subsequent remote side effect. */
	compareAndSet(
		reference: IssueReference,
		expectedRevision: number,
		next: WorkflowRecord,
	): Promise<boolean>;
}
export interface IssueWorkflowOptions {
	clientFor(reference: IssueReference): WorkflowRemote | Promise<WorkflowRemote>;
	persistence: WorkflowPersistence;
	/** Fresh actual checkout HEAD supplied by the host, not receipt metadata. */
	currentImplementationCommit(reference: IssueReference): Promise<string>;
}
const denied = { approved: false, reason: "unproven" } as const;
const workflowLabels = ["workflow::backlog", "workflow::in-progress", "workflow::in-review"];
function stop(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue workflow requires reconciliation.");
}
function revision(issue: GitLabIssue): string {
	return createHash("sha256")
		.update(
			JSON.stringify([issue.updatedAt, issue.description, [...issue.labels].sort(), issue.state]),
		)
		.digest("hex");
}
function checkIssue(issue: GitLabIssue, ref: IssueReference): void {
	const labels = issue.labels.filter((label) => label.toLowerCase().startsWith("workflow::"));
	if (
		issue.iid !== ref.number ||
		issue.state !== "opened" ||
		labels.length !== 1 ||
		!workflowLabels.includes(labels[0] ?? "")
	)
		stop();
}

export function createIssueWorkflow(options: IssueWorkflowOptions) {
	const persistence = options.persistence;
	async function run<T>(
		reference: IssueReference,
		action: (remote: WorkflowRemote, record: WorkflowRecord) => Promise<T>,
	): Promise<T> {
		try {
			if (!isIssueReference(reference)) stop();
			const record = (await persistence.load(reference)) ?? { revision: 0 };
			if (record.pending) stop();
			return await action(await options.clientFor(reference), record);
		} catch {
			return stop();
		}
	}
	async function save(
		ref: IssueReference,
		old: WorkflowRecord,
		next: WorkflowRecord,
	): Promise<WorkflowRecord> {
		const value = { ...next, revision: old.revision + 1 };
		if (!(await persistence.compareAndSet(ref, old.revision, value))) stop();
		return value;
	}
	async function pending(
		ref: IssueReference,
		record: WorkflowRecord,
		operation: NonNullable<WorkflowRecord["pending"]>["operation"],
		version: string,
	) {
		return save(ref, record, { ...record, pending: { operation, version } });
	}
	async function readIssue(remote: WorkflowRemote, ref: IssueReference) {
		const issue = await remote.issue(ref.number);
		checkIssue(issue, ref);
		return issue;
	}
	async function currentImplementationVersion(
		ref: IssueReference,
		design: string,
	): Promise<string> {
		return implementationVersion(await options.currentImplementationCommit(ref), design);
	}
	async function requireImplementationVersion(
		ref: IssueReference,
		design: string,
		version: string,
	) {
		if ((await currentImplementationVersion(ref, design)) !== version) stop();
	}
	async function evidence(
		remote: WorkflowRemote,
		ref: IssueReference,
		receipt: WorkflowReceipt,
		stage: ApprovalStage,
	): Promise<ApprovalResult> {
		const before = await readIssue(remote, ref);
		const design = designVersion(before.description);
		const currentVersion =
			stage === "design" ? design : await currentImplementationVersion(ref, design);
		const notes = await remote.notes(ref.number);
		const events = await remote.labelEvents(ref.number);
		// Resolve every possible approver from fresh effective membership, never local claims.
		const users = [
			...new Set(
				events
					.filter(
						(e) =>
							e.label === tomatoLabels[stage] &&
							e.action === "add" &&
							e.id > receipt.publication.resetEventId,
					)
					.map((e) => e.userId),
			),
		];
		const members = await Promise.all(users.map((id) => remote.member(id)));
		const after = await readIssue(remote, ref);
		if (
			stage === "implementation" &&
			(await currentImplementationVersion(ref, design)) !== currentVersion
		)
			return denied;
		return validateApproval({
			stage,
			version: receipt.publication.version,
			currentVersion: stage === "design" || receipt.designVersion === design ? currentVersion : "",
			publication: receipt.publication,
			resetConfirmedAbsent: receipt.resetConfirmedAbsent,
			notes,
			events,
			labels: after.labels,
			members,
			beforeRevision: revision(before),
			afterRevision: revision(after),
		});
	}
	async function publish(
		ref: IssueReference,
		remote: WorkflowRemote,
		record: WorkflowRecord,
		stage: ApprovalStage,
		version: string,
		description?: string,
		commit?: string,
		design?: string,
		expectedDescription?: string,
	): Promise<ApprovalPublication> {
		const before = await readIssue(remote, ref);
		if (
			(stage === "design" && before.description !== expectedDescription) ||
			(stage === "implementation" && designVersion(before.description) !== design)
		)
			stop();
		const checkCommit = async () => {
			if (stage === "implementation") {
				if (!design || !commit || implementationVersion(commit, design) !== version) stop();
				await requireImplementationVersion(ref, design, version);
			}
		};
		await checkCommit();
		const operation = stage === "design" ? "publish-design" : "publish-implementation";
		const reserved = await pending(ref, record, operation, version);
		const cleared = before.labels.filter(
			(label) =>
				label !== tomatoLabels[stage] &&
				!(stage === "design" && label === tomatoLabels.implementation),
		);
		await checkCommit();
		await remote.updateIssue(ref.number, { labels: cleared });
		const resetBefore = await readIssue(remote, ref);
		const events = await remote.labelEvents(ref.number);
		const resetAfter = await readIssue(remote, ref);
		if (
			revision(resetBefore) !== revision(resetAfter) ||
			resetAfter.labels.includes(tomatoLabels[stage]) ||
			(stage === "design" && resetAfter.labels.includes(tomatoLabels.implementation)) ||
			resetAfter.description !== before.description
		)
			stop();
		// The entire complete history must prove an absent reset, not merely the update response.
		let boundary = 0;
		let lastTime = -Infinity;
		let present = false;
		for (const event of [...events].sort((a, b) => a.id - b.id)) {
			const time = Date.parse(event.createdAt);
			if (
				!Number.isSafeInteger(event.id) ||
				event.id <= boundary ||
				!Number.isFinite(time) ||
				time <= lastTime ||
				event.label === null ||
				!["add", "remove"].includes(event.action)
			)
				stop();
			boundary = event.id;
			lastTime = time;
			if (event.label === tomatoLabels[stage]) present = event.action === "add";
		}
		if (present) stop();
		if (description !== undefined) {
			await remote.updateIssue(ref.number, { description });
			const updated = await readIssue(remote, ref);
			if (
				updated.description !== description ||
				JSON.stringify([...updated.labels].sort()) !== JSON.stringify([...resetAfter.labels].sort())
			)
				stop();
		}
		const body = approvalPublication({ stage, version, noteId: 1, resetEventId: boundary }).body;
		await checkCommit();
		const note = await remote.addNote(ref.number, body);
		if (
			note.body !== body ||
			!Number.isFinite(Date.parse(note.createdAt)) ||
			Date.parse(note.createdAt) <= lastTime
		)
			stop();
		const publication = approvalPublication({
			stage,
			version,
			noteId: note.id,
			resetEventId: boundary,
		});
		const receipt: WorkflowReceipt = {
			publication,
			resetConfirmedAbsent: true,
			approved: false,
			...(commit && design ? { commit, designVersion: design } : {}),
		};
		const next: WorkflowRecord =
			stage === "design"
				? { revision: reserved.revision, design: receipt }
				: { ...reserved, implementation: receipt };
		delete next.pending;
		await checkCommit();
		await save(ref, reserved, next);
		return publication;
	}
	async function designEvidence(
		remote: WorkflowRemote,
		ref: IssueReference,
		record: WorkflowRecord,
	) {
		if (!record.design) return denied;
		return evidence(remote, ref, record.design, "design");
	}
	return {
		publishDesign(reference: IssueReference, expectedDescription: string, newDescription: string) {
			return run(reference, async (remote, record) => {
				const issue = await readIssue(remote, reference);
				if (issue.description !== expectedDescription || typeof newDescription !== "string") stop();
				return publish(
					reference,
					remote,
					record,
					"design",
					designVersion(newDescription),
					newDescription,
					undefined,
					undefined,
					expectedDescription,
				);
			});
		},
		publishImplementation(reference: IssueReference, design: string, fullSHA: string) {
			return run(reference, async (remote, record) => {
				const version = implementationVersion(fullSHA, design);
				if (
					!record.design?.approved ||
					record.design.publication.version !== design ||
					!(await designEvidence(remote, reference, record)).approved
				)
					stop();
				return publish(
					reference,
					remote,
					record,
					"implementation",
					version,
					undefined,
					fullSHA,
					design,
				);
			});
		},
		validateDesign(reference: IssueReference) {
			return validate(reference, "design");
		},
		validateImplementation(reference: IssueReference) {
			return validate(reference, "implementation");
		},
		approveStage(reference: IssueReference, stage: ApprovalStage) {
			return approve(reference, stage);
		},
	};
	async function validate(ref: IssueReference, stage: ApprovalStage): Promise<ApprovalResult> {
		return run(ref, (remote, record) => validateReceipt(ref, remote, record, stage));
	}
	/** App-originated approval: one fresh remote label record by the current actor, then the
	 * existing validation path. It never merges, pushes, creates an MR or authorizes any of them. */
	async function approve(ref: IssueReference, stage: ApprovalStage): Promise<ApprovalResult> {
		return run(ref, async (remote, record) => {
			if (stage !== "design" && stage !== "implementation") stop();
			const receipt = record[stage];
			if (!receipt) stop();
			const user = await remote.currentUser();
			if (!Number.isSafeInteger(user.id) || user.id <= 0) stop();
			const member = await remote.member(user.id);
			// The approving role is read fresh; a lower role denies with the same static error.
			if (member.userId !== user.id || !(member.accessLevel >= 30)) stop();
			// The receipt version must still describe the current remote/local state: stale
			// designs, commits or receipts are never approved.
			const fresh = async () => {
				const issue = await readIssue(remote, ref);
				const design = designVersion(issue.description);
				if (stage === "design") {
					if (design !== receipt.publication.version) stop();
					return issue;
				}
				if (!record.design?.approved || record.design.publication.version !== design) stop();
				if ((await currentImplementationVersion(ref, design)) !== receipt.publication.version)
					stop();
				return issue;
			};
			const before = await fresh();
			// An already recorded app approval is revalidated without a new remote write. Otherwise
			// the durable reservation must exist before the label mutation.
			const needsLabel = !before.labels.includes(tomatoLabels[stage]);
			const reserved = needsLabel
				? await pending(
						ref,
						record,
						stage === "design" ? "approve-design" : "approve-implementation",
						receipt.publication.version,
					)
				: record;
			if (needsLabel) {
				await fresh();
				await remote.updateIssue(ref.number, {
					labels: [
						...before.labels.filter((label) => label !== tomatoLabels[stage]),
						tomatoLabels[stage],
					],
				});
			}
			await fresh();
			const snapshot = await readIssue(remote, ref);
			const events = await remote.labelEvents(ref.number);
			const after = await readIssue(remote, ref);
			// One stable revision boundary across the complete event history.
			if (revision(snapshot) !== revision(after)) stop();
			const added = events
				.filter(
					(event) =>
						event.label === tomatoLabels[stage] && event.id > receipt.publication.resetEventId,
				)
				.sort((a, b) => a.id - b.id)
				.at(-1);
			if (
				added?.action !== "add" ||
				added.userId !== user.id ||
				!Number.isFinite(Date.parse(added.createdAt))
			)
				stop();
			const result = await validateReceipt(ref, remote, reserved, stage);
			// Any mismatch after the reservation leaves it for explicit reconciliation.
			if (!result.approved) stop();
			return result;
		});
	}
	async function validateReceipt(
		ref: IssueReference,
		remote: WorkflowRemote,
		record: WorkflowRecord,
		stage: ApprovalStage,
	): Promise<ApprovalResult> {
		const receipt = record[stage];
		if (!receipt) return denied;
		let result: ApprovalResult;
		if (stage === "design") result = await designEvidence(remote, ref, record);
		else {
			const issue = await readIssue(remote, ref);
			const design = designVersion(issue.description);
			result =
				record.design?.approved &&
				receipt.designVersion === design &&
				(await designEvidence(remote, ref, record)).approved &&
				receipt.commit
					? await evidence(remote, ref, receipt, stage)
					: denied;
		}
		if (!result.approved) {
			await save(ref, record, { ...record, [stage]: { ...receipt, approved: false } });
			return result;
		}
		const issue = await readIssue(remote, ref);
		// Enclose both final evidence reads in one snapshot so design revocation
		// between the reads cannot authorize an implementation transition.
		const checked =
			stage === "design"
				? await designEvidence(remote, ref, record)
				: record.design?.approved && (await designEvidence(remote, ref, record)).approved
					? await evidence(remote, ref, receipt, stage)
					: denied;
		const latest = await readIssue(remote, ref);
		if (!checked.approved || revision(issue) !== revision(latest)) return denied;
		const checkCommit = async () =>
			stage === "design" ||
			(await currentImplementationVersion(ref, designVersion(latest.description))) ===
				receipt.publication.version;
		// This boundary also covers the already-approved/no-transition return.
		if (!(await checkCommit())) return denied;
		// Design approval only advances backlog; revalidation must never regress
		// an issue that has already reached implementation review.
		const target =
			stage === "design" && latest.labels.includes("workflow::in-review")
				? "workflow::in-review"
				: stage === "design"
					? "workflow::in-progress"
					: "workflow::in-review";
		const needsTransition = !latest.labels.includes(target);
		if (!needsTransition && receipt.approved) return checked;
		const operation = stage === "design" ? "approve-design" : "approve-implementation";
		// An app-originated approval already reserved this exact operation; reuse it rather than
		// reserving a second revision of the same intent.
		const reserved =
			record.pending?.operation === operation &&
			record.pending.version === receipt.publication.version
				? record
				: await pending(ref, record, operation, receipt.publication.version);
		if (!(await checkCommit())) stop();
		if (needsTransition)
			await remote.updateIssue(ref.number, {
				labels: [...latest.labels.filter((l) => !workflowLabels.includes(l)), target],
			});
		const after = await readIssue(remote, ref);
		if (
			after.description !== latest.description ||
			!after.labels.includes(target) ||
			!after.labels.includes(tomatoLabels[stage])
		)
			stop();
		if (!(await checkCommit())) stop();
		const next = { ...reserved, [stage]: { ...receipt, approved: true } };
		delete next.pending;
		await save(ref, reserved, next);
		return checked;
	}
}
