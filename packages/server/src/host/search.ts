import { readableFileSize } from "../fs";
import { getHistoryIndex } from "../history";
import { listProjects } from "../projects";
import { createSearchService, type SearchService } from "../search";
import { invalidateSpecSnapshot, specSnapshot } from "../spec";
import { listStoredPlans } from "../todos";
import { listAllWorkspaceRecords } from "../workspaces";

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
			stat: readableFileSize,
		});
	}
	return service;
}
