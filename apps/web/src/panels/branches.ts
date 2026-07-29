import type { BranchList } from "@thinkrail/contracts";
import { getTransport } from "../transport";

/** What an unanswerable branch list degrades to — no branches, and a base every repo resolves. */
const NO_BRANCHES: BranchList = { local: [], remote: [], defaultBranch: "HEAD" };

/**
 * A project's branches for a picker, **offline-degrading**: a failed read answers an empty list rather than
 * rejecting, because every caller wants "show what git could answer" (the base picker still lets a user
 * proceed; the Changes scope menu still offers its other scopes). One helper so the degradation is defined
 * once for both pickers.
 */
export async function listBranchesOrEmpty(projectId: string): Promise<BranchList> {
	try {
		return await getTransport().request("git.listBranches", { projectId });
	} catch {
		return NO_BRANCHES;
	}
}
