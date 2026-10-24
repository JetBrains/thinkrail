import { describeResource, PENDING_TEXT_META } from "@thinkrail/resource-renderers";
import { useEffect } from "react";
import { whenPageActive } from "../lib";
import { useEditorWarm, whenFilesTreeIdle } from "../panels/editorWarm";

const IDLE_TIMEOUT_MS = 2000;
const FALLBACK_DELAY_MS = 1500;

let preloaded = false;

export function useIdleEditorPreload(workspaceId: string): void {
	const warm = useEditorWarm();
	useEffect(() => {
		if (!warm || preloaded) return;
		return whenPageActive(() =>
			whenFilesTreeIdle(
				() => {
					preloaded = true;
					warm(describeResource(workspaceId, "", PENDING_TEXT_META));
				},
				{ timeout: IDLE_TIMEOUT_MS, fallbackDelay: FALLBACK_DELAY_MS },
			),
		);
	}, [warm, workspaceId]);
}
