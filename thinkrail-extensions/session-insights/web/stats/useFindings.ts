import type { PanelHost } from "@thinkrail/extension-api/web";
import type { FindingSeverity, FindingsListResult } from "@thinkrail/pi-session-insights/core";
import { useState } from "react";
import { listScope, type ScopeKind } from "../load";
import { type Polled, usePolled } from "../usePolled";
import { hideFinding, loadFindings, stillReading } from "./api";

export interface FindingsControls {
	/** `findings.list` with the hidden list the last *Hide* answered applied. */
	polled: { view: Polled<FindingsListResult>; busy: boolean };
	onHide: (id: string, hidden: boolean) => void;
	retry: () => void;
}

/**
 * The scope's findings, asked once per scope and refresh while `enabled` (re-asked with the statistics'
 * backoff while sessions are being read) and shared by the Insights badge and *What to do*.
 */
export function useFindings(
	host: PanelHost,
	scopeKind: ScopeKind,
	attempt: number,
	enabled: boolean,
): FindingsControls {
	const [retry, setRetry] = useState(0);
	const [hidden, setHidden] = useState<{ base: string; ids: ReadonlySet<string> } | null>(null);
	const base = `${scopeKind}:${host.scope.projectId}:${attempt}:${retry}`;
	const polled = usePolled(
		`findings:${base}`,
		enabled,
		(signal) => loadFindings(host, listScope(host, scopeKind), signal),
		stillReading,
	);
	const again = () => setRetry((current) => current + 1);
	const onHide = (id: string, hide: boolean) => {
		hideFinding(host, id, hide, new AbortController().signal).then(
			(ids) => setHidden({ base, ids: new Set(ids) }),
			again,
		);
	};
	const { view } = polled;
	const overrides = hidden?.base === base ? hidden.ids : null;
	return {
		polled:
			view.kind === "ready" && overrides
				? {
						...polled,
						view: {
							kind: "ready",
							value: {
								...view.value,
								findings: view.value.findings.map((finding) =>
									finding.hidden === overrides.has(finding.id)
										? finding
										: { ...finding, hidden: overrides.has(finding.id) },
								),
							},
						},
					}
				: polled,
		onHide,
		retry: again,
	};
}

export type FindingsTally = Readonly<Record<FindingSeverity, number>> & { total: number };

/** The findings not hidden, by severity. */
export function tallyFindings(result: FindingsListResult): FindingsTally {
	const tally = { error: 0, warning: 0, info: 0, total: 0 };
	for (const finding of result.findings) {
		if (finding.hidden) continue;
		tally[finding.severity] += 1;
		tally.total += 1;
	}
	return tally;
}
