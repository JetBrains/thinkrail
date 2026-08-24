export interface TabSource {
	href: string | null;
	label: string;
}

export interface EditorTab {
	href: string;
	label: string;
}

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
