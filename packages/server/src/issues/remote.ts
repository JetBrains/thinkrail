import type { IssueProvider } from "@thinkrail/contracts";

/** Provider-neutral read model shared by every Issue transport. */
export interface IssueProject {
	id: number;
	pathWithNamespace: string;
	defaultBranch: string | null;
	httpUrlToRepo: string | null;
	sshUrlToRepo: string | null;
}
export interface IssueLabelColor {
	name: string;
	color: string;
	textColor?: string;
}
export interface IssueRecord {
	iid: number;
	title: string;
	description: string;
	state: "opened" | "closed";
	labels: string[];
	labelColors?: IssueLabelColor[];
	updatedAt: string;
	closedAt?: string | null;
}
export interface IssueNote {
	id: number;
	body: string;
	createdAt: string;
	author?: { name: string; username: string } | null;
	system?: boolean;
}
export interface IssueLabelEvent {
	id: number;
	action: "add" | "remove";
	userId: number;
	label: string | null;
	createdAt: string;
}
export interface IssueMember {
	userId: number;
	accessLevel: number;
}
export interface IssueMergeRequest {
	id: number;
	iid: number;
	webUrl: string;
	state: "opened" | "closed" | "merged" | "locked";
	sourceBranch: string;
	targetBranch: string;
	sha: string | null;
	mergeStatus: string;
	sourceProjectId: number | null;
	targetProjectId: number | null;
	draft: boolean | null;
	detailedMergeStatus: string | null;
	mergeCommitSha: string | null;
	squashCommitSha: string | null;
	headPipeline: { id: number | null; sha: string | null; status: string } | null;
}
export interface IssueMergeEvidence {
	iid: number;
	targetBranch: string;
	mergeCommitSha: string | null;
	targetSha: string | null;
	relationship: "ancestor" | "not-ancestor" | "unknown";
	snapshot: string;
}
export interface IssueMergeReadiness {
	iid: number;
	expectedSha: string;
	actualSha: string | null;
	sourceBranch: string;
	targetBranch: string;
	checks: "passed" | "pending" | "failed" | "unknown";
	approval: "satisfied" | "required" | "unknown";
	snapshot: string;
}
export interface IssueUpdate {
	description?: string;
	labels?: string[];
}
export interface IssueMergeRequestInput {
	sourceBranch: string;
	targetBranch: string;
	title: string;
	description: string;
	draft?: boolean;
}

/** The read and comment surface the Issue panel, startup context and handoff need. */
export interface IssueRemote {
	readonly provider: IssueProvider;
	project(): Promise<IssueProject>;
	issue(iid: number): Promise<IssueRecord>;
	issues(): Promise<IssueRecord[]>;
	notes(iid: number): Promise<IssueNote[]>;
	addNote(iid: number, body: string): Promise<IssueNote>;
}

/** Provider-neutral delivery primitives; obtaining this port does not authorize a workflow. */
export interface IssueDeliveryRemote extends IssueRemote {
	updateIssue(iid: number, input: IssueUpdate): Promise<IssueRecord>;
	closeIssue(iid: number): Promise<IssueRecord>;
	mergeRequest(iid: number): Promise<IssueMergeRequest>;
	mergeReadiness?(iid: number, expectedSha: string): Promise<IssueMergeReadiness>;
	setMergeRequestReady(iid: number): Promise<IssueMergeRequest>;
	mergeMergeRequest(iid: number, sha: string): Promise<IssueMergeRequest>;
	mergeEvidence?(iid: number): Promise<IssueMergeEvidence>;
	targetBranchSha(branch: string): Promise<string>;
	mergeRequests(sourceBranch: string): Promise<IssueMergeRequest[]>;
	createMergeRequest(input: IssueMergeRequestInput): Promise<IssueMergeRequest>;
}

/** GitLab-only approval evidence and merge/closure primitives. */
export interface IssueWorkflowRemote extends IssueDeliveryRemote {
	currentUser(): Promise<{ id: number }>;
	labelEvents(iid: number): Promise<IssueLabelEvent[]>;
	member(userId: number): Promise<IssueMember>;
	mergeRequest(iid: number): Promise<IssueMergeRequest>;
}
