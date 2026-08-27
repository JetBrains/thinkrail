import {
	RiPuzzleLine as Puzzle,
	RiRefreshLine as RefreshCw,
	RiShieldCheckLine as ShieldCheck,
} from "@remixicon/react";
import type { Project, SkillCatalogEntry, SkillDecision, Workspace } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { SkeletonRows } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { IconTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport, reloadSessionResourcesWithSkillBaseline } from "@/transport";

const TIER_META: Record<string, { label: string; hint: string; rank: number }> = {
	bundled: { label: "ThinkRail", hint: "Bundled with the app.", rank: 0 },
	pi: { label: "Pi", hint: "Pi-native / configured.", rank: 1 },
	personal: { label: "Personal", hint: "Your own libraries (~/.claude, ~/.codex, …).", rank: 2 },
	project: { label: "Project", hint: "Committed to the repo — gated behind trust.", rank: 4 },
};

interface Group {
	key: string;
	label: string;
	hint: string;
	isPlugin: boolean;
	items: SkillCatalogEntry[];
}

function groupCatalog(entries: SkillCatalogEntry[]): Group[] {
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
				label: meta?.label ?? key,
				hint: group.isPlugin ? "Claude plugin" : (meta?.hint ?? ""),
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
	const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
	const [entries, setEntries] = useState<SkillCatalogEntry[] | null>(null);
	const [busy, setBusy] = useState(false);
	const workspaceId = workspace?.workspaceId;

	const refresh = useCallback(async () => {
		try {
			setEntries(
				workspaceId
					? await getTransport().request("skills.state", { workspaceId })
					: await getTransport().request("project.skills", { projectId }),
			);
		} catch {
			setEntries([]);
		}
	}, [workspaceId, projectId]);

	useEffect(() => {
		if (!open) return;
		setEntries(null);
		void refresh();
	}, [open, refresh]);

	const mutate = async (request: () => Promise<Project | Workspace>, failure: string) => {
		if (busy) return;
		setBusy(true);
		try {
			const result = await request();
			if (!isWorkspace(result)) useAppStore.getState().applyProjectUpdated(result);
			await refresh();
		} catch (err) {
			toast.error(errorText(err), failure);
		} finally {
			setBusy(false);
		}
	};

	const reload = async () => {
		if (busy || !workspace) return;
		setBusy(true);
		try {
			const { syncedTick } = await reloadSessionResourcesWithSkillBaseline(workspace.workspaceId, {
				sessionId: workspace.sessionId,
			});
			workspace.onReloaded?.(syncedTick);
			toast.success("This chat now uses the updated skills.", "Skills reloaded");
		} catch (err) {
			toast.error(errorText(err), "Couldn't reload skills");
		} finally {
			setBusy(false);
		}
	};

	const setGroupEnabled = (group: string, enabled: boolean) =>
		void mutate(
			() => getTransport().request("project.setGroupEnabled", { id: projectId, group, enabled }),
			"Couldn't update group",
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
			"Couldn't update skill",
		);

	const disabledGroups = new Set(project?.disabledGroups ?? []);
	const pluginsDisabled = disabledGroups.has("@plugins");
	const untrustedCount = entries?.filter((e) => e.decision === "untrusted").length ?? 0;
	const groups = groupCatalog(entries ?? []);
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
					<Toggle
						on={groupOn}
						busy={busy || lockedByMaster}
						testid="group-toggle"
						onClick={() => setGroupEnabled(group.key, !groupOn)}
					/>
				</div>
				<div className="ml-8 divide-y divide-border-default border-border-default border-l">
					{group.items.map((entry) => (
						<SkillRow
							key={`${group.key}:${entry.name}`}
							entry={entry}
							busy={busy}
							groupOff={!groupOn}
							onToggle={(enabled) => setSkillEnabled(entry.name, enabled)}
							onAcknowledge={() =>
								void mutate(
									() =>
										getTransport().request("project.acknowledgeSkills", {
											id: projectId,
											names: [entry.name],
										}),
									"Couldn't confirm skill",
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
			<DialogContent data-testid="skills-dialog" className="max-w-[560px] gap-12 p-12">
				<div className="flex items-center justify-between gap-8 pr-[2rem]">
					<DialogTitle className="tr-text-ui text-text-default">Skills</DialogTitle>
					{workspace ? (
						<IconTooltip
							label={
								workspace.streaming
									? "Available once the current turn finishes"
									: "Apply to this chat"
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
								Reload
							</Button>
						</IconTooltip>
					) : null}
				</div>

				{workspace?.stale ? (
					<div
						data-testid="skills-stale"
						className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
					>
						This worktree's skills changed on disk —{" "}
						<span className="text-text-default">Reload</span> to apply them to this chat.
					</div>
				) : null}

				{untrustedCount > 0 ? (
					<div
						data-testid="skills-trust-all"
						className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8"
					>
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							{untrustedCount} project skill{untrustedCount === 1 ? "" : "s"} off until you trust
							this repo.
						</span>
						<Button
							size="sm"
							disabled={busy}
							onClick={() =>
								void mutate(
									() =>
										getTransport().request("project.setTrust", { id: projectId, trusted: true }),
									"Couldn't trust project",
								)
							}
						>
							Trust project
						</Button>
					</div>
				) : null}

				<div className="max-h-[50vh] overflow-y-auto">
					{entries === null ? (
						<div className="px-8 py-12">
							<SkeletonRows rows={4} />
						</div>
					) : entries.length === 0 ? (
						<p className="px-8 py-12 text-text-muted tr-text-ui">No skills discovered.</p>
					) : (
						<>
							{leadingGroups.map(renderGroup)}
							{hasPlugins ? (
								<div
									data-testid="skills-all-plugins"
									className="sticky top-0 z-20 flex h-32 items-center gap-8 border-border-default border-y bg-container-header-bg px-8"
								>
									<span className="min-w-0 flex-1 tr-text-eyebrow text-text-default">
										All plugins
									</span>
									<Toggle
										on={!pluginsDisabled}
										busy={busy}
										testid="all-plugins-toggle"
										onClick={() => setGroupEnabled("@plugins", pluginsDisabled)}
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

function Toggle({
	on,
	busy,
	testid,
	onClick,
}: {
	on: boolean;
	busy: boolean;
	testid: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			data-on={on}
			disabled={busy}
			onClick={onClick}
			className={cn(
				"shrink-0 rounded-[var(--radius-sm)] border px-8 py-2 tr-text-metadata transition-colors disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				on
					? "border-primary-muted bg-clip-padding bg-primary-subtle text-primary"
					: "border-border-default text-text-muted hover:bg-control-bg-hovered",
			)}
		>
			{on ? "on" : "off"}
		</button>
	);
}

const DECISION_TEXT: Record<SkillDecision, string> = {
	load: "on",
	disabled: "off",
	untrusted: "trust to enable",
	"pending-ack": "new",
};

function SkillRow({
	entry,
	busy,
	groupOff,
	onToggle,
	onAcknowledge,
}: {
	entry: SkillCatalogEntry;
	busy: boolean;
	groupOff: boolean;
	onToggle: (enabled: boolean) => void;
	onAcknowledge: () => void;
}) {
	const loaded = entry.decision === "load";
	return (
		<div
			data-testid="skill-row"
			data-skill={entry.name}
			data-decision={entry.decision}
			className="flex items-center gap-8 py-8 pr-8 pl-12 hover:bg-control-bg-hovered"
		>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate tr-text-ui text-text-default">{entry.name}</span>
				{entry.description ? (
					<span className="truncate text-text-muted tr-text-metadata">{entry.description}</span>
				) : null}
			</span>
			{entry.decision === "pending-ack" ? (
				<Button size="sm" data-testid="skill-ack" disabled={busy} onClick={onAcknowledge}>
					<ShieldCheck className="size-14" />
					Enable
				</Button>
			) : entry.decision === "untrusted" ? (
				<span className="shrink-0 text-text-muted tr-text-metadata">{DECISION_TEXT.untrusted}</span>
			) : groupOff ? (
				<span
					className="shrink-0 text-text-muted tr-text-metadata"
					title="Enable the group to change this skill"
				>
					group off
				</span>
			) : (
				<button
					type="button"
					data-testid="skill-toggle"
					data-on={loaded}
					disabled={busy}
					onClick={() => onToggle(!loaded)}
					className={cn(
						"shrink-0 rounded-[var(--radius-sm)] border px-8 py-2 tr-text-metadata transition-colors disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
						loaded
							? "border-primary-muted bg-clip-padding bg-primary-subtle text-primary"
							: "border-border-default text-text-muted hover:bg-control-bg-hovered",
					)}
				>
					{DECISION_TEXT[entry.decision]}
				</button>
			)}
		</div>
	);
}
