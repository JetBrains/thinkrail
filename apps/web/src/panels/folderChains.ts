export interface FolderChainNode {
	kind: "dir" | "file";
	name: string;
	path: string;
}

export interface FolderChain {
	/** Slash-joined names from the visible row's first directory through its current deepest directory. */
	label: string;
	/** Path of the current deepest directory represented by the compact row. */
	path: string;
	/** Every directory path represented by the row, shallowest to deepest. */
	paths: readonly string[];
}

/** A directory row after following its run of single-directory children. */
export interface ResolvedFolderChain<TNode extends FolderChainNode> extends FolderChain {
	/** Immediate children of the deepest directory. */
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

/** Extend a chain by exactly one directory, or stop at a file, empty directory, or branch. */
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

/**
 * Resolve one visible directory row without walking a branching subtree. The caller supplies the directory
 * reader, keeping this presentation rule independent from transport and straightforward to unit-test.
 */
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
