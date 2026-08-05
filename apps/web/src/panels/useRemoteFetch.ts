import { useState } from "react";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

/**
 * The `↓` indicator's manual **Fetch** action (`git.fetchNow`) for one workspace — the single
 * implementation both call sites that render `RemoteIndicator` (`ComparisonTarget`'s host, `ChangesPanel`,
 * and the rail's `WorkspaceRow`) use, so a fix to the fetch/fold/toast sequence lands once. Unlike the
 * silent background pull (`ChangesPanel`'s initial `git.remoteState` read), this is a user-initiated
 * action, so a rejection toasts rather than failing quietly — a git fetch can fail for reasons (bad
 * credentials, no network) worth surfacing.
 */
export function useRemoteFetch(workspaceId: string): { fetching: boolean; fetchNow: () => void } {
	const [fetching, setFetching] = useState(false);
	const fetchNow = () => {
		void (async () => {
			setFetching(true);
			try {
				const result = await getTransport().request("git.fetchNow", { workspaceId });
				useAppStore.getState().noteRemoteState(result);
			} catch (error) {
				// No client-side prefix: the server's own rejection (`policy.ts`'s `fetchRefNow`) already reads
				// "Could not fetch <ref>: <detail>" — prefixing it again here doubled the phrase.
				toast.error(errorText(error, "Could not fetch."));
			} finally {
				setFetching(false);
			}
		})();
	};
	return { fetching, fetchNow };
}
