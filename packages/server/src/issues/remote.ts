import type { IssueProvider } from "@thinkrail/contracts";

/** Provider-neutral read model shared by every Issue transport. */
export interface IssueProject {
	id: number;
	pathWithNamespace: string;
	defaultBranch: string | null;
	httpUrlToRepo: string | null;
	sshUrlToRepo: string | null;
}
export interface IssueRecord {
	iid: number;
	title: string;
	description: string;
	state: "opened" | "closed";
	labels: string[];
	updatedAt: string;
}
export interface IssueNote {
	id: number;
	body: string;
	createdAt: string;
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
export interface IssueUpdate {
	description?: string;
	labels?: string[];
}
export interface IssueMergeRequestInput {
	sourceBranch: string;
	targetBranch: string;
	title: string;
	description: string;
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

/**
 * Merge-request lifecycle and label ownership stay GitLab-only in this protocol. Obtaining one is
 * an explicit service call, so a GitHub reference can never reach these methods by accident.
 */
export interface IssueWorkflowRemote extends IssueRemote {
	currentUser(): Promise<{ id: number }>;
	labelEvents(iid: number): Promise<IssueLabelEvent[]>;
	member(userId: number): Promise<IssueMember>;
	updateIssue(iid: number, input: IssueUpdate): Promise<IssueRecord>;
	mergeRequests(sourceBranch: string): Promise<IssueMergeRequest[]>;
	createMergeRequest(input: IssueMergeRequestInput): Promise<IssueMergeRequest>;
	mergeRequest(iid: number): Promise<IssueMergeRequest>;
	mergeMergeRequest(iid: number, sha: string): Promise<IssueMergeRequest>;
	closeIssue(iid: number): Promise<IssueRecord>;
}
