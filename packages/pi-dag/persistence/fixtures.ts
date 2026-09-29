import { canonicalJson, type DagState } from "../domain/index.ts";
import type { DagStore } from "./index.ts";

export async function snapshot(store: DagStore, scope: string, dagId = "dag"): Promise<DagState> {
	const definition = {
		title: "Stored DAG",
		defaults: { tools: [] },
		nodes: [{ id: "worker", task: "Work", outputs: {} }],
		connections: [],
	};
	const definitionFile = await store.put(dagId, canonicalJson(definition));
	const taskFile = await store.put(dagId, "Work");
	return {
		schemaVersion: 1,
		scope,
		dagId,
		title: definition.title,
		version: 1,
		graphRevision: 1,
		mode: "paused",
		lifecycle: "active",
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
		definitionValue: definition,
		definitionFile,
		profile: { cwd: "/workspace" },
		nodes: {
			worker: { id: "worker", taskFile, attempts: [], held: false, cancelled: false },
		},
		proposals: {},
		gates: {},
		captures: {},
		receipts: {},
		interventions: [],
		history: [],
		notices: [],
		attachments: [],
	};
}
