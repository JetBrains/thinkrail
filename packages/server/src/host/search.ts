import type { TextSearchBatch } from "@thinkrail/contracts";
import { classifyBytes, readableFileSize } from "../fs";
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
			isText: (bytes) => classifyBytes(bytes).text,
		});
	}
	return service;
}

type TextSearchPublisher = (clientKey: string, batch: TextSearchBatch) => void;

let textPublisher: TextSearchPublisher | null = null;

export function setSearchTextPublisher(publisher: TextSearchPublisher | null): void {
	textPublisher = publisher;
}

export function publishSearchText(clientKey: string, batch: TextSearchBatch): void {
	textPublisher?.(clientKey, batch);
}
