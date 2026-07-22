/** The chat tab's slim top bar: extension status lines only. (Token/cost/context usage moved to the
 * left-panel footer — see `SessionStatsBar` / task-usage-in-footer.) Renders nothing when there are no
 * status entries, so there's no empty bar under the tabs. */
export function ChatHeader({ statusEntries }: { statusEntries: [string, string][] }) {
	if (statusEntries.length === 0) return null;
	return (
		<div className="flex min-h-9 shrink-0 flex-wrap items-center justify-end gap-md border-border2 border-b bg-bg-dark px-sm py-xs">
			{statusEntries.map(([key, text]) => (
				<span key={key} className="text-muted text-xs">
					{text}
				</span>
			))}
		</div>
	);
}
