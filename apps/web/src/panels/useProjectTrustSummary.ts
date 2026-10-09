import type { ProjectTrustSummary } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { selectSupportsProjectTrust, useAppStore } from "@/store";
import { getTransport } from "@/transport";

const NOTHING_GATED: ProjectTrustSummary = {
	aliasSkills: [],
	nativeResources: false,
};

export function useProjectTrustSummary(
	projectId: string,
	enabled = true,
): ProjectTrustSummary | null {
	const supportsProjectTrust = useAppStore(selectSupportsProjectTrust);
	const [summary, setSummary] = useState<ProjectTrustSummary | null>(null);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		setSummary(null);
		const transport = getTransport();
		const read = supportsProjectTrust
			? transport.request("project.trustSummary", { projectId })
			: transport
					.request("project.aliasSkills", { projectId })
					.then((aliasSkills) => ({ ...NOTHING_GATED, aliasSkills }));
		read
			.then((next) => {
				if (!cancelled) setSummary(next);
			})
			.catch(() => {
				if (!cancelled) setSummary(NOTHING_GATED);
			});
		return () => {
			cancelled = true;
		};
	}, [enabled, projectId, supportsProjectTrust]);

	return summary;
}
