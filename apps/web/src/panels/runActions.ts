import type {
	HostPlatform,
	ProjectRun,
	RunExecution,
	RunRecipe,
	RunTarget,
	RunWorkspaceState,
} from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import { isLiveRun, latestExecution } from "../store";
import type { ShipTone } from "./shipActions";

export type RunAction =
	| { kind: "setUp" }
	| { kind: "start"; targetId: string | null; prepare: boolean }
	| { kind: "restart"; targetId: string | null }
	| { kind: "stop"; targetId: string | null }
	| { kind: "open"; url: string }
	| { kind: "showTerminal"; tabKey: string }
	| { kind: "fix"; execution: RunExecution | null }
	| { kind: "openTab" };

export interface RunMenuItem {
	action: RunAction;
	label: string;
	tone?: ShipTone;
	disabled?: true;
	checked?: boolean;
}

export type RunChipTone = "neutral" | "success" | "warning" | "info";

export interface RunSegmentModel {
	caption: string;
	chip: { label: string; tone: RunChipTone; live: boolean } | null;
	primary: (RunMenuItem & { short: string }) | null;
	open: { url: string; label: string } | null;
	secondary: RunMenuItem[];
}

export interface RunContext {
	supported: boolean;
	hostPlatform: HostPlatform | null;
	run: ProjectRun | undefined;
	state: RunWorkspaceState | undefined;
}

export function runAvailable(context: Pick<RunContext, "supported" | "hostPlatform">): boolean {
	return context.supported && context.hostPlatform !== "win32";
}

export function targetName(target: Pick<RunTarget, "id" | "title">): string {
	return target.title ?? target.id;
}

function targetOf(recipe: RunRecipe, targetId: string | null): RunTarget | null {
	return targetId === null
		? null
		: (recipe.targets.find((target) => target.id === targetId) ?? null);
}

export function executionLabel(
	t: Translator,
	execution: RunExecution,
	recipe: RunRecipe | null,
): string {
	if (execution.targetId === null) return t("panels.run.prepareTarget");
	const target = recipe ? targetOf(recipe, execution.targetId) : null;
	return target ? targetName(target) : execution.targetId;
}

export function urlPort(url: string | undefined): number | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (parsed.port) return Number(parsed.port);
		return parsed.protocol === "https:" ? 443 : 80;
	} catch {
		return null;
	}
}

export function statusChip(
	t: Translator,
	execution: RunExecution,
): { label: string; tone: RunChipTone; live: boolean } {
	switch (execution.status) {
		case "starting":
			return { label: t("panels.run.status.starting"), tone: "info", live: true };
		case "running":
			return { label: t("panels.run.status.running"), tone: "success", live: true };
		case "listening": {
			const port = urlPort(execution.url);
			return {
				label:
					port === null
						? t("panels.run.status.running")
						: t("panels.run.status.listening", { port }),
				tone: "success",
				live: true,
			};
		}
		case "stopping":
			return { label: t("panels.run.status.stopping"), tone: "info", live: true };
		case "stopped":
			return { label: t("panels.run.status.stopped"), tone: "neutral", live: false };
		case "exited":
			if (execution.exitCode === null || execution.exitCode === undefined) {
				return { label: t("panels.run.status.ended"), tone: "neutral", live: false };
			}
			return execution.exitCode === 0
				? { label: t("panels.run.status.finished"), tone: "success", live: false }
				: {
						label: t("panels.run.status.exited", { code: execution.exitCode }),
						tone: "warning",
						live: false,
					};
	}
}

export function failed(execution: RunExecution | null): boolean {
	return (
		execution !== null &&
		execution.status === "exited" &&
		execution.exitCode !== null &&
		execution.exitCode !== undefined &&
		execution.exitCode !== 0
	);
}

function startItem(
	t: Translator,
	target: RunTarget,
	primary: boolean,
): RunMenuItem & { short: string } {
	return {
		action: { kind: "start", targetId: target.id, prepare: true },
		label: t("panels.run.start.label", { target: targetName(target) }),
		short: t("panels.run.start.short"),
		tone: "primary",
		...(primary ? { checked: true } : {}),
	};
}

export function runActions(t: Translator, context: RunContext): RunSegmentModel | null {
	if (!runAvailable(context)) return null;
	const recipe = context.run?.document?.recipe ?? null;
	const openTab: RunMenuItem = { action: { kind: "openTab" }, label: t("panels.run.openTab") };
	if (!recipe) {
		return {
			caption: t("panels.run.caption"),
			chip: null,
			primary: {
				action: { kind: "setUp" },
				label: t("panels.run.setUp.label"),
				short: t("panels.run.setUp.short"),
				tone: "primary",
			},
			open: null,
			secondary: [openTab],
		};
	}
	const latest = latestExecution(context.state);
	const primaryTarget = targetOf(recipe, recipe.primary);
	const followed = latest ? targetOf(recipe, latest.targetId) : primaryTarget;
	const caption = latest
		? t("panels.run.captionTarget", { target: executionLabel(t, latest, recipe) })
		: t("panels.run.caption");
	const targetItems = recipe.targets.map((target) =>
		startItem(t, target, target.id === recipe.primary),
	);
	const fix: RunMenuItem = {
		action: { kind: "fix", execution: latest },
		label: t("panels.run.fix.label"),
		tone: "warning",
	};
	const prepare: RunMenuItem = {
		action: { kind: "start", targetId: null, prepare: true },
		label: t("panels.run.prepareOnly"),
	};

	if (latest && isLiveRun(latest)) {
		const stopping = latest.status === "stopping";
		const open =
			latest.status === "listening" && latest.url
				? { url: latest.url, label: t("panels.run.open") }
				: null;
		return {
			caption,
			chip: statusChip(t, latest),
			primary: {
				action: { kind: "stop", targetId: latest.targetId },
				label: t("panels.run.stop"),
				short: t("panels.run.stop"),
				tone: "neutral",
				...(stopping ? { disabled: true as const } : {}),
			},
			open,
			secondary: [
				{ action: { kind: "restart", targetId: latest.targetId }, label: t("panels.run.restart") },
				...(open ? [{ action: { kind: "open" as const, url: open.url }, label: open.label }] : []),
				{
					action: { kind: "showTerminal", tabKey: latest.tabKey },
					label: t("panels.run.showTerminal"),
				},
				...targetItems.filter(
					(item) => item.action.kind === "start" && item.action.targetId !== latest.targetId,
				),
				fix,
				openTab,
			],
		};
	}

	const runAgain: (RunMenuItem & { short: string }) | null =
		latest && followed
			? {
					action: { kind: "start", targetId: followed.id, prepare: true },
					label: t("panels.run.start.label", { target: targetName(followed) }),
					short: t("panels.run.start.short"),
					tone: "primary",
				}
			: latest && latest.targetId === null
				? {
						action: { kind: "start", targetId: null, prepare: true },
						label: t("panels.run.prepareOnly"),
						short: t("panels.run.prepareShort"),
						tone: "primary",
					}
				: null;
	const startPrimary = primaryTarget ? startItem(t, primaryTarget, true) : null;
	const primary = failed(latest)
		? { ...fix, short: t("panels.run.fix.short") }
		: (runAgain ?? startPrimary);
	const withoutPrepare: RunMenuItem[] = followed
		? [
				{
					action: { kind: "start", targetId: followed.id, prepare: false },
					label: t("panels.run.startWithoutPrepare", { target: targetName(followed) }),
				},
			]
		: [];
	return {
		caption,
		chip: latest ? statusChip(t, latest) : null,
		primary,
		open: null,
		secondary: [
			...(failed(latest) && runAgain ? [runAgain] : []),
			...targetItems.filter(
				(item) => item.action.kind === "start" && item.action.targetId !== followed?.id,
			),
			...withoutPrepare,
			prepare,
			...(latest
				? [
						{
							action: { kind: "showTerminal" as const, tabKey: latest.tabKey },
							label: t("panels.run.showTerminal"),
						},
					]
				: []),
			...(failed(latest) ? [] : [fix]),
			openTab,
		],
	};
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "[::]"]);

export function browserUrl(url: string, transportHostname: string): string {
	try {
		const parsed = new URL(url);
		if (!LOOPBACK_HOSTS.has(parsed.hostname) || LOOPBACK_HOSTS.has(transportHostname)) return url;
		parsed.hostname = transportHostname;
		return parsed.toString();
	} catch {
		return url;
	}
}
