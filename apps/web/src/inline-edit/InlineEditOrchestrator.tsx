import { useEffect } from "react";
import { useAppStore } from "@/store";
import { refreshTabContent } from "./actions";

/**
 * Headless: watch inline-edit requests and run the post-turn readback. When a request first enters `review`
 * without `afterContent`, re-read the file (refresh any open tab) and store the fresh content as the review's
 * anchor/revert base. Mounted once (in CenterTabs), so it runs regardless of which tab is focused.
 */
export function InlineEditOrchestrator() {
	const inlineEdits = useAppStore((s) => s.inlineEdits);
	useEffect(() => {
		for (const req of Object.values(inlineEdits)) {
			if (req.status === "review" && req.afterContent === undefined) {
				void refreshTabContent(req.workspaceId, req.path).then(() => {
					const fresh = useAppStore.getState().inlineEdits[req.id];
					if (!fresh || fresh.afterContent !== undefined) return;
					const tab = (useAppStore.getState().tabsByWorkspace[req.workspaceId] ?? []).find(
						(t) => t.kind === "file" && t.id === `${req.workspaceId}:${req.path}`,
					);
					// No open tab to read from: fall back to the fire-time original (`turns[0].baseContent`) —
					// the pre-per-turn-model `beforeContent` field's modern equivalent.
					const content =
						tab && tab.kind === "file" ? tab.content : (fresh.turns[0]?.baseContent ?? "");
					useAppStore.getState().setInlineEditAfterContent(req.id, content);
				});
			}
		}
	}, [inlineEdits]);
	return null;
}
