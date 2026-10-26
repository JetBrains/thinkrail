import {
	RiPuzzleLine as Puzzle,
	RiRefreshLine as RefreshCw,
	RiShieldCheckLine as ShieldCheck,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import type { Project, SkillCatalogEntry, Workspace } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { T, type Translator, t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useState } from "react";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport, reloadSessionResourcesWithSkillBaseline } from "@/transport";
import {
	deriveProjectTrustNotice,
	trustEnablesText,
	trustGrantParams,
	untrustedNoticeText,
} from "./projectTrust";
import { useProjectTrustSummary } from "./useProjectTrustSummary";

const TIER_META: Record<string, { label: MessageKey | null; hint: MessageKey; rank: number }> = {
	bundled: { label: null, hint: "chat.skills.tier.bundledHint", rank: 0 },
	pi: { label: null, hint: "chat.skills.tier.piHint", rank: 1 },
	personal: { label: "chat.skills.tier.personal", hint: "chat.skills.tier.personalHint", rank: 2 },
	project: { label: "chat.skills.tier.project", hint: "chat.skills.tier.projectHint", rank: 4 },
};

const TIER_BRAND: Record<string, string> = { bundled: "ThinkRail", pi: "Pi" };

interface Group {
	key: string;
	label: string;
	hint: string;
	isPlugin: boolean;
	items: SkillCatalogEntry[];
}

function groupCatalog(t: Translator, entries: SkillCatalogEntry[]): Group[] {
	const byKey = new Map<string, { isPlugin: boolean; items: SkillCatalogEntry[] }>();
	for (const entry of entries) {
		const group = byKey.get(entry.group) ?? { isPlugin: Boolean(entry.plugin), items: [] };
		group.items.push(entry);
		byKey.set(entry.group, group);
	}
	return [...byKey.entries()]
		.map(([key, group]) => {
			const meta = TIER_META[key];
			return {
				key,
				label: meta?.label ? t(meta.label) : (TIER_BRAND[key] ?? key),
				hint: group.isPlugin ? t("chat.skills.pluginHint") : meta ? t(meta.hint) : "",
				isPlugin: group.isPlugin,
				items: group.items,
				rank: group.isPlugin ? 3 : (meta?.rank ?? 5),
			};
		})
		.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

function isWorkspace(result: Project | Workspace): result is Workspace {
	return "projectId" in result;
}

export interface SkillsWorkspaceContext {
	workspaceId: string;
	sessionId: string;
	streaming: boolean;
	stale?: boolean;
	onReloaded?: (syncedTick: number) => void;
}

export function SkillsDialog({
	projectId,
	workspace,
	open,
	onOpenChange,
}: {
	projectId: string;
	workspace?: SkillsWorkspaceContext;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
	const [entries, setEntries] = useState<SkillCatalogEntry[] | null>(null);
	const [busy, setBusy] = useState(false);
	const workspaceId = workspace?.workspaceId;
	const trustSummary = useProjectTrustSummary(projectId, open);

	const refresh = useCallback(async () => {
		const load = async () =>
			setEntries(
				workspaceId
					? await getTransport().request("skills.state", { workspaceId })
					: await getTransport().request("project.skills", { projectId }),
			);
		await load().catch(() => setEntries([]));
	}, [workspaceId, projectId]);

	useEffect(() => {
		if (!open) return;
		setEntries(null);
		void refresh();
	}, [open, refresh]);

	const mutate = async (request: () => Promise<Project | Workspace>, failure: string) => {
		if (busy) return;
		setBusy(true);
		const run = async () => {
			const result = await request();
			if (!isWorkspace(result)) useAppStore.getState().applyProjectUpdated(result);
			await refresh();
		};
		await run()
			.catch((err: unknown) => toast.error(errorText(err), failure))
			.finally(() => setBusy(false));
	};

	const reload = async () => {
		if (busy || !workspace) return;
		setBusy(true);
		const run = async () => {
			const { syncedTick } = await reloadSessionResourcesWithSkillBaseline(workspace.workspaceId, {
				sessionId: workspace.sessionId,
			});
			workspace.onReloaded?.(syncedTick);
			toast.success(translate("chat.skills.reloadedBody"), translate("chat.skills.reloadedTitle"));
		};
		await run()
			.catch((err: unknown) => toast.error(errorText(err), translate("chat.skills.reloadFailed")))
			.finally(() => setBusy(false));
	};

	const setGroupEnabled = (group: string, enabled: boolean) =>
		void mutate(
			() => getTransport().request("project.setGroupEnabled", { id: projectId, group, enabled }),
			translate("chat.skills.groupUpdateFailed"),
		);

	const setSkillEnabled = (name: string, enabled: boolean) =>
		void mutate(
			() =>
				workspace
					? getTransport().request("workspace.setSkillOverride", {
							id: workspace.workspaceId,
							name,
							override: enabled ? "on" : "off",
						})
					: getTransport().request("project.setSkillEnabled", { id: projectId, name, enabled }),
			translate("chat.skills.skillUpdateFailed"),
		);

	const disabledGroups = new Set(project?.disabledGroups ?? []);
	const pluginsDisabled = disabledGroups.has("@plugins");
	const catalogAliases = (entries ?? [])
		.filter((entry) => entry.decision === "untrusted")
		.map((entry) => entry.name);
	const trustNotice = deriveProjectTrustNotice(
		project,
		trustSummary && {
			...trustSummary,
			aliasSkills: [...new Set([...trustSummary.aliasSkills, ...catalogAliases])],
		},
	);
	const trustEnables = trustNotice.kind === "untrusted" ? trustEnablesText(t, trustNotice) : null;
	const groups = groupCatalog(t, entries ?? []);
	const hasPlugins = groups.some((g) => g.isPlugin);
	const isLeadingKey = (key: string) => key === "bundled" || key === "pi";
	const leadingGroups = groups.filter((g) => isLeadingKey(g.key));
	const otherGroups = groups.filter((g) => !isLeadingKey(g.key));

	const renderGroup = (group: Group) => {
		const lockedByMaster = group.isPlugin && pluginsDisabled;
		const groupOn = !lockedByMaster && !disabledGroups.has(group.key);
		return (
			<div key={group.key} data-testid="skill-group" data-group={group.key} data-on={groupOn}>
				<div
					className={cn(
						"sticky z-10 flex items-center gap-8 border-border-default border-y bg-container-header-bg px-8 py-8",
						hasPlugins && !isLeadingKey(group.key) ? "top-32" : "top-0",
					)}
				>
					{group.isPlugin ? (
						<Puzzle className="size-14 shrink-0 text-text-muted" aria-hidden />
					) : null}
					<span className="tr-text-eyebrow text-text-default">{group.label}</span>
					<span className="min-w-0 flex-1 truncate text-text-muted tr-text-metadata">
						{group.hint}
					</span>
					<span className="shrink-0 rounded-full bg-control-bg-selected px-8 text-text-muted tr-text-metadata">
						{group.items.length}
					</span>
					<SkillSwitch
						checked={groupOn}
						busy={busy}
						blockedReason={lockedByMaster ? t("chat.skills.blockedByPlugins") : undefined}
						label={t("chat.skills.enableGroup", { group: group.label })}
						testId="group-toggle"
						onCheckedChange={(enabled) => setGroupEnabled(group.key, enabled)}
					/>
				</div>
				<div className="ml-8 divide-y divide-border-default border-border-default border-l">
					{group.items.map((entry) => (
						<SkillRow
							key={`${group.key}:${entry.name}`}
							entry={entry}
							busy={busy}
							blockedReason={
								groupOn
									? undefined
									: lockedByMaster
										? t("chat.skills.blockedByPlugins")
										: t("chat.skills.blockedByGroup", { group: group.label })
							}
							onToggle={(enabled) => setSkillEnabled(entry.name, enabled)}
							onAcknowledge={() =>
								void mutate(
									() =>
										getTransport().request("project.acknowledgeSkills", {
											id: projectId,
											names: [entry.name],
										}),
									translate("chat.skills.acknowledgeFailed"),
								)
							}
						/>
					))}
				</div>
			</div>
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="skills-dialog" className="max-w-[640px] gap-12 p-12">
				<div className="flex items-center justify-between gap-8 pr-[2rem]">
					<DialogTitle className="tr-text-ui text-text-default">
						{t("chat.skills.title")}
					</DialogTitle>
					{workspace ? (
						<IconTooltip
							label={
								workspace.streaming ? t("chat.skills.reloadBusy") : t("chat.skills.reloadHint")
							}
							wrapTrigger
						>
							<Button
								size="sm"
								variant="outline"
								data-testid="skills-reload"
								disabled={busy || workspace.streaming}
								onClick={() => void reload()}
							>
								<RefreshCw className="size-14" />
								{t("chat.skills.reload")}
							</Button>
						</IconTooltip>
					) : null}
				</div>

				{workspace?.stale ? (
					<div
						data-testid="skills-stale"
						className="rounded-sm border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
					>
						<T
							i18nKey="chat.skills.staleNotice"
							components={[<span key="reload" className="text-text-default" />]}
						/>
					</div>
				) : null}

				{trustNotice.kind === "untrusted" ? (
					<div
						data-testid="skills-trust-all"
						className="flex flex-col gap-8 rounded-sm border border-feedback-warning-muted bg-container-elevated-bg px-12 py-8"
					>
						<div className="flex items-start gap-8">
							<TriangleAlert className="mt-2 size-14 shrink-0 text-feedback-warning" aria-hidden />
							<span className="flex min-w-0 flex-1 flex-col gap-2">
								<span className="tr-text-ui text-text-default">
									{untrustedNoticeText(t, trustNotice)}
								</span>
								{trustEnables ? (
									<span className="text-text-muted tr-text-metadata">{trustEnables}</span>
								) : null}
							</span>
						</div>
						<div className="flex justify-end">
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() =>
									void mutate(
										() =>
											getTransport().request(
												"project.setTrust",
												trustGrantParams(projectId, trustNotice),
											),
										translate("chat.skills.trustFailed"),
									)
								}
							>
								{t("chat.skills.trustProject")}
							</Button>
						</div>
					</div>
				) : null}

				<div className="max-h-[50vh] overflow-y-auto">
					{entries === null ? (
						<LoadingRegion rows={4} className="px-8 py-12" />
					) : entries.length === 0 ? (
						<p className="px-8 py-12 text-text-muted tr-text-ui">{t("chat.skills.empty")}</p>
					) : (
						<>
							{leadingGroups.map(renderGroup)}
							{hasPlugins ? (
								<div
									data-testid="skills-all-plugins"
									className="sticky top-0 z-20 flex h-32 items-center gap-8 border-border-default border-y bg-container-header-bg px-8"
								>
									<span className="min-w-0 flex-1 tr-text-eyebrow text-text-default">
										{t("chat.skills.allPlugins")}
									</span>
									<SkillSwitch
										checked={!pluginsDisabled}
										busy={busy}
										label={t("chat.skills.enableAllPlugins")}
										testId="all-plugins-toggle"
										onCheckedChange={(enabled) => setGroupEnabled("@plugins", enabled)}
									/>
								</div>
							) : null}
							{otherGroups.map(renderGroup)}
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function SkillSwitch({
	checked,
	busy,
	blockedReason,
	label,
	testId,
	onCheckedChange,
}: {
	checked: boolean;
	busy: boolean;
	blockedReason?: string | undefined;
	label: string;
	testId: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	const t = useT();
	const disabled = busy || blockedReason !== undefined;
	const tooltip = busy
		? t("chat.skills.saving")
		: (blockedReason ?? (checked ? t("chat.skills.switchOn") : t("chat.skills.switchOff")));
	return (
		<IconTooltip label={tooltip} wrapTrigger={disabled}>
			<Switch
				checked={checked}
				disabled={disabled}
				label={label}
				aria-description={tooltip}
				data-on={checked}
				testId={testId}
				onCheckedChange={onCheckedChange}
			/>
		</IconTooltip>
	);
}

function SkillRow({
	entry,
	busy,
	blockedReason,
	onToggle,
	onAcknowledge,
}: {
	entry: SkillCatalogEntry;
	busy: boolean;
	blockedReason?: string | undefined;
	onToggle: (enabled: boolean) => void;
	onAcknowledge: () => void;
}) {
	const t = useT();
	const loaded = entry.decision === "load";
	return (
		<div
			data-testid="skill-row"
			data-skill={entry.name}
			data-decision={entry.decision}
			className="flex items-center gap-12 py-12 pr-8 pl-12 hover:bg-control-bg-hovered"
		>
			<span className="flex min-w-0 flex-1 flex-col gap-4">
				<span className="truncate tr-title-card text-text-default">{entry.name}</span>
				{entry.description ? (
					<span title={entry.description} className="line-clamp-2 text-text-muted tr-text-metadata">
						{entry.description}
					</span>
				) : null}
			</span>
			{entry.decision === "pending-ack" ? (
				<Button size="sm" data-testid="skill-ack" disabled={busy} onClick={onAcknowledge}>
					<ShieldCheck className="size-14" />
					{t("chat.skills.enable")}
				</Button>
			) : (
				<SkillSwitch
					checked={entry.decision === "untrusted" || blockedReason ? false : loaded}
					busy={busy}
					blockedReason={
						entry.decision === "untrusted" ? t("chat.skills.blockedByTrust") : blockedReason
					}
					label={t("chat.skills.enableSkill", { skill: entry.name })}
					testId="skill-toggle"
					onCheckedChange={onToggle}
				/>
			)}
		</div>
	);
}
