import type { ExtensionContainer, ExtensionHostServices } from "@thinkrail/extension-api/server";
import {
	AUTOPILOT_DEBOUNCE_MS,
	flagged,
	OFFER_RETRY_MS,
	type Offer,
	type PilotCard,
	type PilotWip,
	planOffers,
	select,
} from "./autopilot";
import { readyText, WAKE_READY, withdrawText } from "./kickoff";
import type { AutopilotPause, CardSize, Initiative } from "./model";
import type { Roadmap } from "./roadmap";

/** What autopilot needs of its board: the host, the roadmap, the clock and the selection's inputs. */
export interface PilotHost {
	host: ExtensionHostServices;
	roadmap: Roadmap;
	now(): number;
	/** The initiative's cards as the selection reads them, and its board's WIP. */
	inputs(projectId: string, initiative: Initiative): Promise<{ cards: PilotCard[]; wip: PilotWip }>;
	changed(projectId: string): void;
}

export interface AutopilotOptions {
	delayMs?: number;
	retryMs?: number;
}

/** A ready card as the initiative panel and the container overview list it. */
export interface ReadyCardView {
	id: string;
	title: string;
	size?: CardSize;
	/** Offered to the orchestrator and not started yet. */
	offered: boolean;
	/** Offered twice and still not started: the orchestrator didn't start it. */
	stale: boolean;
}

/** An initiative's autopilot as the web half shows it: on, paused (with why) or off, and its room. */
export interface AutopilotView {
	projectId: string;
	initiativeId: string;
	title: string;
	on: boolean;
	/** While on: what holds it back now; `null` when nothing does. */
	pausedReason: AutopilotPause | null;
	container: {
		id: string;
		name: string;
		members: number;
		orchestrator: ExtensionContainer["orchestrator"];
	} | null;
	running: number;
	cap: number;
	ready: ReadyCardView[];
}

const samePause = (left: AutopilotPause | undefined, right: AutopilotPause | null) =>
	JSON.stringify(left ?? null) === JSON.stringify(right);

/**
 * The host decides *when*: on every board change (debounced), each initiative with autopilot on gets its
 * selection and pause re-evaluated, its pause recorded, and its container's orchestrator woken with every
 * card it offers now — each offered once, again once after `retryMs`, then flagged. A pause or a switch-off
 * withdraws the offers with a `board-ready` update of its own.
 */
export class Autopilot {
	private readonly board: PilotHost;
	private readonly delayMs: number;
	readonly retryMs: number;
	private readonly offers = new Map<string, Map<string, Offer>>();
	private readonly stale = new Map<string, string[]>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private due: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private evaluating: Promise<void> | null = null;
	private again = false;

	constructor(board: PilotHost, options: AutopilotOptions = {}) {
		this.board = board;
		this.delayMs = options.delayMs ?? AUTOPILOT_DEBOUNCE_MS;
		this.retryMs = options.retryMs ?? OFFER_RETRY_MS;
	}

	start(): void {
		this.running = true;
		this.schedule();
	}

	stop(): void {
		this.running = false;
		for (const timer of [this.timer, this.due]) if (timer) clearTimeout(timer);
		this.timer = null;
		this.due = null;
	}

	/**
	 * Asks for an evaluation after the debounce; a no-op unless the host service runs and one is piloted.
	 * A request while one is armed joins it, so changes that keep coming evaluate at most once per delay.
	 */
	schedule(): void {
		if (!this.running || this.timer || this.board.roadmap.piloted().length === 0) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.kick();
		}, this.delayMs);
	}

	private kick(): void {
		if (this.evaluating) {
			this.again = true;
			return;
		}
		this.evaluating = this.evaluate()
			.catch((error) => this.board.host.log.warn("autopilot failed", error))
			.finally(() => {
				this.evaluating = null;
				if (this.again) {
					this.again = false;
					this.kick();
				}
			});
	}

	/** Resolves once the scheduled and running evaluations have settled. */
	async idle(): Promise<void> {
		while (this.timer || this.evaluating) {
			if (this.evaluating) await this.evaluating;
			else await new Promise((resolve) => setTimeout(resolve, this.delayMs));
		}
	}

	/** Drops what autopilot remembers of an initiative (switched off, or its container gone). */
	forget(projectId: string, initiativeId: string): void {
		this.offers.delete(`${projectId}:${initiativeId}`);
		this.stale.delete(`${projectId}:${initiativeId}`);
	}

	/**
	 * The human switched the initiative's autopilot off: its offers are forgotten, and an orchestrator that
	 * still had some to act on gets a `board-ready` update withdrawing them.
	 */
	async switchedOff(projectId: string, initiative: Initiative): Promise<void> {
		const key = `${projectId}:${initiative.id}`;
		const stale = new Set(this.stale.get(key) ?? []);
		const withdrawn = [...(this.offers.get(key)?.keys() ?? [])].filter((id) => !stale.has(id));
		this.forget(projectId, initiative.id);
		if (withdrawn.length > 0 && initiative.containerId)
			await this.withdraw(initiative.containerId, initiative, withdrawn, null);
	}

	private async withdraw(
		containerId: string,
		initiative: Initiative,
		withdrawn: readonly string[],
		pause: AutopilotPause | null,
	): Promise<void> {
		const container = this.board.host
			.containers()
			.find((candidate) => candidate.id === containerId);
		if (!container?.orchestrator) return;
		try {
			await this.board.host.actions.wakeOrchestrator({
				containerId,
				kind: WAKE_READY,
				text: withdrawText({ initiative, withdrawn, pause }),
			});
		} catch (error) {
			this.board.host.log.warn(
				`autopilot could not withdraw its offers from ${containerId}`,
				error,
			);
		}
	}

	/** The initiative as stored now, while its autopilot is on with a container; `null` once off or gone. */
	private piloting(projectId: string, initiativeId: string): Initiative | null {
		try {
			const initiative = this.board.roadmap.initiativeById(projectId, initiativeId);
			return initiative.autopilot?.on === true && initiative.containerId !== undefined
				? initiative
				: null;
		} catch {
			return null;
		}
	}

	/** Every piloted initiative once; then the next offer's due time arms a timer. */
	async evaluate(): Promise<void> {
		let dueAt: number | null = null;
		for (const { projectId, initiative } of this.board.roadmap.piloted()) {
			try {
				const next = await this.pilot(projectId, initiative.id);
				if (next !== null) dueAt = dueAt === null ? next : Math.min(dueAt, next);
			} catch (error) {
				this.board.host.log.warn(`autopilot of ${initiative.id} failed`, error);
			}
		}
		if (this.due) clearTimeout(this.due);
		this.due = null;
		if (dueAt !== null && this.running)
			this.due = setTimeout(
				() => {
					this.due = null;
					this.kick();
				},
				Math.max(0, dueAt - this.board.now()),
			);
	}

	/**
	 * One initiative: its selection over fresh inputs, acted on only while its autopilot is still on with the
	 * same container once they arrived — a switch-off meanwhile records, offers and wakes nothing.
	 */
	private async pilot(projectId: string, initiativeId: string): Promise<number | null> {
		const key = `${projectId}:${initiativeId}`;
		const { roadmap, host } = this.board;
		const initiative = this.piloting(projectId, initiativeId);
		if (!initiative) return null;
		const container = host
			.containers()
			.find((candidate) => candidate.id === initiative.containerId);
		if (!container) {
			this.forget(projectId, initiative.id);
			roadmap.setContainer(projectId, initiative.id, null);
			roadmap.setAutopilot(projectId, initiative.id, { on: false });
			return null;
		}
		const { cards, wip } = await this.board.inputs(projectId, initiative);
		const current = this.piloting(projectId, initiative.id);
		if (current?.containerId !== container.id) return null;
		const now = this.board.now();
		const previous = this.offers.get(key) ?? new Map<string, Offer>();
		const selection = select(cards, wip, {
			orchestrator: container.orchestrator !== null,
			held: flagged(previous, now, this.retryMs),
		});
		if (!samePause(current.autopilot?.pausedReason, selection.pause))
			roadmap.setAutopilotPause(projectId, current.id, selection.pause);
		const plan = planOffers(
			selection.selected.map((card) => card.id),
			selection.ready.map((card) => card.id),
			previous,
			now,
			this.retryMs,
		);
		if ((this.stale.get(key) ?? []).join(",") !== plan.stale.join(",")) {
			this.stale.set(key, plan.stale);
			this.board.changed(projectId);
		}
		if (selection.pause) {
			const withdrawn = [...plan.offers.keys()].filter((id) => !plan.stale.includes(id));
			this.offers.set(key, new Map([...plan.offers].filter(([id]) => plan.stale.includes(id))));
			if (withdrawn.length > 0)
				await this.withdraw(container.id, current, withdrawn, selection.pause);
			return null;
		}
		this.offers.set(key, plan.offers);
		if (plan.offer.length === 0) return plan.dueAt;
		const fresh = new Set(plan.offer.filter((id) => !previous.has(id)));
		const selected = new Map(selection.selected.map((card) => [card.id, card]));
		try {
			await host.actions.wakeOrchestrator({
				containerId: container.id,
				kind: WAKE_READY,
				text: readyText({
					initiative: current,
					cards: plan.outstanding.flatMap((id) => {
						const card = selected.get(id);
						return card ? [{ ...card, fresh: fresh.has(id) }] : [];
					}),
					running: selection.running,
					cap: selection.cap,
					retryMinutes: Math.round(this.retryMs / 60_000),
				}),
			});
		} catch (error) {
			if (this.offers.get(key) === plan.offers) {
				const kept = new Map(plan.offers);
				for (const id of plan.offer) {
					const before = previous.get(id);
					if (before) kept.set(id, before);
					else kept.delete(id);
				}
				this.offers.set(key, kept);
			}
			host.log.warn(`autopilot could not wake the orchestrator of ${container.id}`, error);
		}
		return plan.dueAt;
	}

	/** The initiative's autopilot now, computed like an evaluation but sending nothing. */
	async view(projectId: string, initiative: Initiative): Promise<AutopilotView> {
		const container = initiative.containerId
			? this.board.host.containers().find((candidate) => candidate.id === initiative.containerId)
			: undefined;
		const { cards, wip } = await this.board.inputs(projectId, initiative);
		const selection = select(cards, wip, {
			orchestrator: container ? container.orchestrator !== null : true,
		});
		const key = `${projectId}:${initiative.id}`;
		const offers = this.offers.get(key);
		const stale = new Set(this.stale.get(key) ?? []);
		const on = initiative.autopilot?.on === true && container !== undefined;
		return {
			projectId,
			initiativeId: initiative.id,
			title: initiative.title,
			on,
			pausedReason: on ? selection.pause : null,
			container: container
				? {
						id: container.id,
						name: container.name,
						members: container.workspaceIds.length,
						orchestrator: container.orchestrator,
					}
				: null,
			running: selection.running,
			cap: selection.cap,
			ready: selection.ready.map((card) => ({
				id: card.id,
				title: card.title,
				...(card.size ? { size: card.size } : {}),
				offered: offers?.has(card.id) === true && !stale.has(card.id),
				stale: stale.has(card.id),
			})),
		};
	}
}
