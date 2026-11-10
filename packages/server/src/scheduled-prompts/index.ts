import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ImageContent,
	PromptModelSelection,
	ScheduledPromptRecord,
} from "@thinkrail/contracts";
import {
	acceptScheduledFollowUpSession,
	ensureSessionAttached,
	getSessionWorkspaceId,
	validatePromptModelSelection,
} from "../agent";
import { dataDir } from "../persistence";
import { getWorkspace } from "../workspaces";

export type ScheduledPrompt = ScheduledPromptRecord;

const path = () => join(dataDir(), "scheduled-prompts.json");
let records: ScheduledPrompt[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let publish: ((workspaceId: string, records: ScheduledPrompt[]) => void) | undefined;
let stopped = true;
const deliveries = new Map<string, Promise<void>>();
const inFlight = new Set<ScheduledPrompt>();
let nextSavedOrder = 1;

export function isValidScheduledDueAt(dueAt: number, now = Date.now()): boolean {
	return Number.isSafeInteger(dueAt) && dueAt % 60_000 === 0 && dueAt > now;
}

function hasPromptContent(text: string, images: ImageContent[] | undefined): boolean {
	return text.trim().length > 0 || (images?.length ?? 0) > 0;
}

function persist(): void {
	mkdirSync(dataDir(), { recursive: true });
	const target = path();
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(records, null, "\t")}\n`);
		renameSync(temporary, target);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function notify(workspaceId: string): void {
	persist();
	publish?.(workspaceId, listScheduledPrompts(workspaceId));
}

export function listScheduledPrompts(workspaceId: string): ScheduledPrompt[] {
	return records
		.filter((record) => record.workspaceId === workspaceId)
		.sort(compareScheduledPrompts);
}

function compareScheduledPrompts(a: ScheduledPrompt, b: ScheduledPrompt): number {
	return (
		a.dueAt - b.dueAt ||
		(a.savedOrder ?? a.createdAt) - (b.savedOrder ?? b.createdAt) ||
		a.createdAt - b.createdAt ||
		a.id.localeCompare(b.id)
	);
}

function hasSavedOrder(value: number | undefined): value is number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

export function createScheduledPrompt(
	input: Omit<ScheduledPrompt, "id" | "createdAt" | "savedOrder" | "status"> & { id: string },
): ScheduledPrompt {
	if (!hasPromptContent(input.text, input.images) || !isValidScheduledDueAt(input.dueAt)) {
		throw new Error("Prompt text or an image and a future whole-minute time are required.");
	}
	if (records.some((record) => record.id === input.id)) {
		const existing = records.find((record) => record.id === input.id);
		if (
			existing?.workspaceId === input.workspaceId &&
			existing.sessionId === input.sessionId &&
			existing.text === input.text &&
			existing.dueAt === input.dueAt &&
			JSON.stringify(existing.images ?? []) === JSON.stringify(input.images ?? []) &&
			JSON.stringify(existing.modelSelection) === JSON.stringify(input.modelSelection)
		)
			return existing;
		throw new Error("Scheduled prompt id already exists.");
	}
	if (getSessionWorkspaceId(input.sessionId) !== input.workspaceId)
		throw new Error("Session not found in workspace.");
	if (input.modelSelection) validatePromptModelSelection(input.sessionId, input.modelSelection);
	const record: ScheduledPrompt = {
		...input,
		createdAt: Date.now(),
		savedOrder: nextSavedOrder++,
		status: "scheduled",
	};
	records.push(record);
	notify(record.workspaceId);
	arm();
	return record;
}

export function updateScheduledPrompt(
	id: string,
	workspaceId: string,
	dueAt: number,
	text: string,
	images?: ImageContent[],
	modelSelection?: PromptModelSelection,
): ScheduledPrompt {
	const record = records.find((item) => item.id === id && item.workspaceId === workspaceId);
	if (!record) throw new Error("Scheduled prompt is unavailable.");
	if (!hasPromptContent(text, images) || !isValidScheduledDueAt(dueAt))
		throw new Error("Prompt text or an image and a future time are required.");
	if (modelSelection) validatePromptModelSelection(record.sessionId, modelSelection);
	if (modelSelection) record.modelSelection = modelSelection;
	record.dueAt = dueAt;
	record.text = text;
	record.savedOrder = nextSavedOrder++;
	if (images) record.images = images;
	else delete record.images;
	record.status = "scheduled";
	delete record.error;
	notify(workspaceId);
	arm();
	return record;
}

export function cancelScheduledPrompt(id: string, workspaceId: string): boolean {
	const before = records.length;
	records = records.filter((item) => !(item.id === id && item.workspaceId === workspaceId));
	if (before === records.length) return false;
	notify(workspaceId);
	arm();
	return true;
}

export async function sendScheduledPromptNow(
	id: string,
	workspaceId: string,
): Promise<{ accepted: boolean }> {
	const record = records.find((item) => item.id === id && item.workspaceId === workspaceId);
	if (record?.status !== "scheduled") throw new Error("Scheduled prompt is unavailable.");
	record.dueAt = Date.now();
	notify(workspaceId);
	try {
		await deliverDue();
		return { accepted: !records.includes(record) };
	} finally {
		arm();
	}
}

async function deliverDue(now = Date.now()): Promise<void> {
	const pending: Promise<void>[] = [];
	for (const record of [...records]
		.filter((item) => item.status === "scheduled" && item.dueAt <= now && !inFlight.has(item))
		.sort(compareScheduledPrompts)) {
		const prior = deliveries.get(record.sessionId) ?? Promise.resolve();
		inFlight.add(record);
		const next = prior.then(async () => {
			if (!records.includes(record) || record.status !== "scheduled") return;
			if (record.dueAt > Date.now()) return;
			record.status = "delivering";
			delete record.error;
			notify(record.workspaceId);
			try {
				const workspace = getWorkspace(record.workspaceId);
				await ensureSessionAttached(record.sessionId, record.workspaceId, workspace.worktreePath);
				if (
					!records.includes(record) ||
					record.status !== "delivering" ||
					record.dueAt > Date.now()
				)
					return;
				if (getSessionWorkspaceId(record.sessionId) !== record.workspaceId)
					throw new Error("Session or workspace no longer exists.");
				const accepted = await acceptScheduledFollowUpSession(
					record.sessionId,
					record.text,
					record.images as ImageContent[] | undefined,
					record.modelSelection,
					() =>
						records.includes(record) &&
						record.status === "delivering" &&
						record.dueAt <= Date.now(),
				);
				if (!accepted) {
					if (records.includes(record) && record.status === "delivering") {
						record.status = "scheduled";
						notify(record.workspaceId);
					}
					return;
				}
				records = records.filter((item) => item !== record);
				notify(record.workspaceId);
			} catch (error) {
				record.status = "failed";
				record.error = error instanceof Error ? error.message : "Prompt delivery failed.";
				notify(record.workspaceId);
			}
		});
		deliveries.set(record.sessionId, next);
		pending.push(next);
		const cleanup = () => {
			inFlight.delete(record);
			if (deliveries.get(record.sessionId) === next) deliveries.delete(record.sessionId);
		};
		void next.then(cleanup, cleanup);
	}
	await Promise.all(pending);
}

function dispatchDue(): void {
	const delivery = deliverDue();
	arm();
	void delivery.then(arm, arm);
}

function arm(): void {
	if (timer) clearTimeout(timer);
	if (stopped) return;
	const next = records
		.filter((item) => item.status === "scheduled" && !inFlight.has(item))
		.sort(compareScheduledPrompts)[0];
	if (next)
		timer = setTimeout(dispatchDue, Math.max(0, Math.min(2_147_000_000, next.dueAt - Date.now())));
}

export function startScheduledPrompts(publisher: typeof publish): void {
	publish = publisher;
	stopped = false;
	try {
		records = JSON.parse(readFileSync(path(), "utf8")) as ScheduledPrompt[];
	} catch {
		records = [];
	}
	if (records.some((record) => !hasSavedOrder(record.savedOrder))) {
		let order = Math.max(
			0,
			...records.map((record) => (hasSavedOrder(record.savedOrder) ? record.savedOrder : 0)),
		);
		for (const record of [...records].sort(
			(a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
		))
			if (!hasSavedOrder(record.savedOrder)) record.savedOrder = ++order;
		persist();
	}
	nextSavedOrder =
		Math.max(
			0,
			...records.map((record) => (hasSavedOrder(record.savedOrder) ? record.savedOrder : 0)),
		) + 1;
	for (const record of records)
		if (record.status === "delivering") {
			record.status = "failed";
			record.error = "Delivery outcome uncertain after restart; review before retrying.";
		}
	dispatchDue();
}

export function stopScheduledPrompts(): void {
	stopped = true;
	if (timer) clearTimeout(timer);
	timer = undefined;
	inFlight.clear();
	deliveries.clear();
	publish = undefined;
}
