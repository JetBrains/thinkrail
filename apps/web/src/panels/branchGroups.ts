export interface RemoteBranchGroup {
	remote: string;
	branches: { ref: string; name: string }[];
}

export function groupBranchesByRemote(refs: readonly string[]): RemoteBranchGroup[] {
	const groups: RemoteBranchGroup[] = [];
	for (const ref of refs) {
		const slash = ref.indexOf("/");
		const remote = slash === -1 ? "Remote" : ref.slice(0, slash);
		const name = slash === -1 ? ref : ref.slice(slash + 1);
		const group = groups.find((candidate) => candidate.remote === remote);
		if (group) group.branches.push({ ref, name });
		else groups.push({ remote, branches: [{ ref, name }] });
	}
	return groups;
}
