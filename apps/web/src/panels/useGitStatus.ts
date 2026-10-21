import type { GitStatus } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useRef, useState } from "react";
import { selectDiffBaseRef, selectDiffScope, toast, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { scopeKey } from "./changesModel";
import { useWorkspaceRead } from "./useWorkspaceRead";

export function useGitStatus(workspaceId: string) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const warnedRef = useRef(false);
	const setDiffScope = useAppStore((s) => s.setDiffScope);
	const scope = useAppStore((s) => selectDiffScope(s, workspaceId));
	const baseRef = useAppStore((s) => selectDiffBaseRef(s, workspaceId));

	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.status", { workspaceId: id, scope }),
		{
			onResult: (result) => {
				setStatus(result);
				setError(null);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				if (wsErrorCode(failure) === "UNKNOWN_COMMIT") {
					setDiffScope(workspaceId, { kind: "branch" });
					toast.info(
						scope.kind === "turn" ? t("changes.panel.turnGone") : t("changes.panel.commitGone"),
					);
					return;
				}
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(t("changes.refreshFailed", { error: errorText(failure) }));
				}
				setError(errorText(failure));
			},
			onSwitch: () => {
				setStatus(null);
				setError(null);
				warnedRef.current = false;
			},
		},
		`${scopeKey(scope)}:${baseRef}`,
	);

	return { status, error, reload };
}
