import type { BranchList, RemoteBranchGroup } from "@thinkrail/contracts";

export type RemoteBranchPresentation =
	| { kind: "grouped"; groups: RemoteBranchGroup[] }
	| { kind: "flat"; refs: string[] };

export function remoteBranchPresentation(branches: BranchList | null): RemoteBranchPresentation {
	if (Array.isArray(branches?.remoteGroups)) {
		return { kind: "grouped", groups: branches.remoteGroups };
	}
	return { kind: "flat", refs: branches?.remote ?? [] };
}

export function hasRemoteBranches(presentation: RemoteBranchPresentation): boolean {
	return presentation.kind === "grouped"
		? presentation.groups.some((group) => group.branches.length > 0)
		: presentation.refs.length > 0;
}
