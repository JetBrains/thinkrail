export interface FolderChainNode {
	kind: "dir" | "file";
	name: string;
	path: string;
}

export interface FolderChain {
	label: string;
	path: string;
	paths: readonly string[];
}

export interface ResolvedFolderChain<TNode extends FolderChainNode> extends FolderChain {
	children: readonly TNode[];
}

export function startFolderChain(node: FolderChainNode): FolderChain {
	return { label: node.name, path: node.path, paths: [node.path] };
}

function hasSingleDirectoryChild<TNode extends FolderChainNode>(
	children: readonly TNode[],
): children is readonly [TNode & { kind: "dir" }] {
	return children.length === 1 && children[0]?.kind === "dir";
}

export function extendFolderChain<TNode extends FolderChainNode>(
	chain: FolderChain,
	children: readonly TNode[],
): { chain: FolderChain; directory: TNode & { kind: "dir" } } | null {
	if (!hasSingleDirectoryChild(children)) return null;
	const directory = children[0];
	return {
		chain: {
			label: `${chain.label}/${directory.name}`,
			path: directory.path,
			paths: [...chain.paths, directory.path],
		},
		directory,
	};
}

export async function resolveFolderChain<TNode extends FolderChainNode>(
	start: TNode,
	readChildren: (path: string) => Promise<readonly TNode[]>,
): Promise<ResolvedFolderChain<TNode>> {
	let chain = startFolderChain(start);
	let children = await readChildren(chain.path);

	for (;;) {
		const extension = extendFolderChain(chain, children);
		if (!extension) return { ...chain, children };
		chain = extension.chain;
		children = await readChildren(extension.directory.path);
	}
}
