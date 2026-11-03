import { readableFileSize } from "../fs";
import { getHistoryIndex } from "../history";
import { listProjects } from "../projects";
import { createSearchService, type SearchService } from "../search";
import { invalidateSpecSnapshot, specSnapshot } from "../spec";
import { listStoredPlans } from "../todos";
import { ensureWatch } from "../watch";
import { listAllWorkspaceRecords, listWorkspaces } from "../workspaces";

let service: SearchService | null = null;

export function hostSearch(): SearchService {
	if (!service) {
		service = createSearchService({
			projects: listProjects,
			workspaces: listAllWorkspaceRecords,
			sessions: () => getHistoryIndex().sessions(),
			specs: specSnapshot,
			plans: listStoredPlans,
			invalidateSpecs: invalidateSpecSnapshot,
			ensureDefault: (projectId) => listWorkspaces(projectId, { includeDiffStats: false }),
			watchRoot: (workspaceId) => void ensureWatch(workspaceId, { prewarm: true }),
			stat: readableFileSize,
		});
	}
	return service;
}
