import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { STORE_DIR, type TodoPlan as StoredPlan, TodoStore } from "pi-todos/core";

export interface StoredPlanFile {
	readonly sessionId: string;
	readonly path: string;
	readonly read: () => StoredPlan;
}

const PLAN_FILE = /^([A-Za-z0-9_-]+)\.json$/;
const PLAN_CACHE_LIMIT = 2_048;
const parsedPlans = new Map<string, { mtimeMs: number; size: number; plan: StoredPlan }>();

function readPlan(store: TodoStore): StoredPlan {
	let stats: { mtimeMs: number; size: number };
	try {
		stats = statSync(store.file);
	} catch {
		parsedPlans.delete(store.file);
		return store.read();
	}
	const cached = parsedPlans.get(store.file);
	if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.plan;
	const plan = store.read();
	parsedPlans.delete(store.file);
	if (plan.todos.length === 0 && plan.groups.length === 0) return plan;
	parsedPlans.set(store.file, { mtimeMs: stats.mtimeMs, size: stats.size, plan });
	if (parsedPlans.size > PLAN_CACHE_LIMIT) {
		const oldest = parsedPlans.keys().next().value;
		if (oldest !== undefined) parsedPlans.delete(oldest);
	}
	return plan;
}

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
		plans.push({ sessionId, path: store.file, read: () => readPlan(store) });
	}
	return plans;
}
