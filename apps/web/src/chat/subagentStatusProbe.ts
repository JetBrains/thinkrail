import type { DelegationRunStatus } from "@thinkrail/contracts";
import { wsErrorCode } from "@/transport";

export interface SubagentTranscriptKey {
	workspaceId: string;
	parentSessionId: string;
	childSessionId: string;
}

export type SubagentTranscriptReader = (
	params: SubagentTranscriptKey,
) => Promise<{ status?: DelegationRunStatus }>;

export async function probeSubagentRunStatus(
	read: SubagentTranscriptReader,
	params: SubagentTranscriptKey,
): Promise<DelegationRunStatus | undefined> {
	try {
		return (await read(params)).status;
	} catch (error) {
		if (wsErrorCode(error) === "SUBAGENT_TRANSCRIPT_NOT_FOUND") return undefined;
		throw error;
	}
}
