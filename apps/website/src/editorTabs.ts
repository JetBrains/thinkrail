/** A navigational row of the file tree, reduced to what a tab needs. */
export interface TabSource {
	href: string | null;
	label: string;
}

export interface EditorTab {
	href: string;
	label: string;
}

/**
 * The file tree is the source of truth for the page's navigation; the tab strip is derived from it so
 * the two lists cannot drift. The tree is hierarchical and may point several rows at the same section
 * (FEATURES and its first child both target `#worktrees`), so the strip holds exactly ONE tab per unique
 * target — first row wins. That is what lets scroll-spy light exactly one tab per section.
 */
export function deriveEditorTabs(rows: readonly TabSource[]): EditorTab[] {
	const tabs: EditorTab[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		if (!row.href || seen.has(row.href)) continue;
		seen.add(row.href);
		tabs.push({ href: row.href, label: row.label });
	}
	return tabs;
}
