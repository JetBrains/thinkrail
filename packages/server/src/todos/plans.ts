import { readdirSync } from "node:fs";
import { join } from "node:path";
import { STORE_DIR, type TodoPlan as StoredPlan, TodoStore } from "pi-todos/core";

export interface StoredPlanFile {
	readonly sessionId: string;
	readonly path: string;
	readonly read: () => StoredPlan;
}

const PLAN_FILE = /^([A-Za-z0-9_-]+)\.json$/;

export function listStoredPlans(root: string): StoredPlanFile[] {
	let names: string[];
	try {
		names = readdirSync(join(root, STORE_DIR));
	} catch {
		return [];
	}
	const plans: StoredPlanFile[] = [];
	for (const name of names) {
		const sessionId = PLAN_FILE.exec(name)?.[1];
		if (!sessionId) continue;
		const store = new TodoStore(root, sessionId);
		plans.push({ sessionId, path: store.file, read: () => store.read() });
	}
	return plans;
}
