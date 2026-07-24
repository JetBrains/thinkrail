import type { Project, SkillCatalogEntry, SkillDecision, Workspace } from "@thinkrail/contracts";
import { Puzzle, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

/**
 * The Skills manager. Two modes from one component:
 * - **workspace** (chat header): `skills.state` catalog, per-**workspace** skill overrides, and a Reload
 *   that applies changes to that chat's running session.
 * - **project** (Welcome / New Workspace, no session yet): `project.skills` catalog, per-**project**-baseline
 *   skill toggles, no Reload.
 * Both share trust, re-confirm-new, and the per-project **group** toggles (a plugin / source tier, or all
 * plugins at once). Skills are grouped by source — ThinkRail / Pi / Personal / a group per Claude plugin /
 * Project — with sticky section headers; the first-party ThinkRail and Pi groups lead, above the All-plugins
 * master (which governs only the plugin groups).
 */
// ThinkRail-bundled + pi-native first-party skills lead; then personal, then plugins (sorted), then the
// repo's gated project skills last.
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

/** Group entries by their canonical group key; order ThinkRail → Pi → Personal → plugins (sorted) → Project. */
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

/** A mutation result carries `projectId` only when it's a Workspace; Project has no such field. */
function isWorkspace(result: Project | Workspace): result is Workspace {
	return "projectId" in result;
}

/** Chat-mode extras: a live session to reload after changes. Absent in project mode (pre-session). */
export interface SkillsWorkspaceContext {
	workspaceId: string;
	sessionId: string;
	streaming: boolean;
	/** Skills changed on disk since the session loaded — prompt a reload. */
	stale?: boolean;
	/** Fired after a successful reload so the caller can clear its stale flag. */
	onReloaded?: () => void;
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

	// Fold a mutation's echoed record into the store (Project only — a Workspace update also arrives on the
	// workspace.updated push), then re-read the catalog so decisions reflect the change.
	const mutate = async (request: () => Promise<Project | Workspace>, failure: string) => {
		if (busy) return;
		setBusy(true);
		try {
			const result = await request();
			if (!isWorkspace(result)) {
				const store = useAppStore.getState();
				store.setProjects(store.projects.map((p) => (p.id === result.id ? result : p)));
			}
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
			await getTransport().request("session.reloadResources", { sessionId: workspace.sessionId });
			workspace.onReloaded?.();
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
	// First-party skills (ThinkRail + Pi) render above the all-plugins master — they aren't plugins and
	// the master doesn't govern them; every other group renders below it.
	const isLeadingKey = (key: string) => key === "bundled" || key === "pi";
	const leadingGroups = groups.filter((g) => isLeadingKey(g.key));
	const otherGroups = groups.filter((g) => !isLeadingKey(g.key));

	const renderGroup = (group: Group) => {
		// A plugin group is locked off when the "all plugins" master is off; either way a disabled
		// group grays its skill toggles (re-enable the group to change individual skills).
		const lockedByMaster = group.isPlugin && pluginsDisabled;
		const groupOn = !lockedByMaster && !disabledGroups.has(group.key);
		return (
			<div key={group.key} data-testid="skill-group" data-group={group.key} data-on={groupOn}>
				{/* Sticky section header (VSCode-style): pins while the group is in view, then the next
				    group's header pushes it out. The first-party leads (ThinkRail, Pi) sit at the scroll top
				    (`top-0`), above the all-plugins master; every other header pins below the master at
				    `top-8` when plugins exist. No `overflow-hidden` ancestor (would clip sticky); an opaque
				    bg keeps rows from bleeding through. */}
				<div
					className={cn(
						"sticky z-10 flex items-center gap-sm border-border2 border-y bg-bg-dark px-sm py-1.5",
						hasPlugins && !isLeadingKey(group.key) ? "top-8" : "top-0",
					)}
				>
					{group.isPlugin ? <Puzzle className="size-3.5 shrink-0 text-hint" aria-hidden /> : null}
					<span className="font-medium text-text text-xs uppercase tracking-wide">
						{group.label}
					</span>
					<span className="min-w-0 flex-1 truncate text-hint text-xs">{group.hint}</span>
					<span className="shrink-0 rounded-full bg-hover px-1.5 text-hint text-xs">
						{group.items.length}
					</span>
					<Toggle
						on={groupOn}
						busy={busy || lockedByMaster}
						testid="group-toggle"
						onClick={() => setGroupEnabled(group.key, !groupOn)}
					/>
				</div>
				{/* Indent + left rail nests the skills visually under their group/plugin header. */}
				<div className="ml-sm divide-y divide-border2 border-border2 border-l">
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
			<DialogContent data-testid="skills-dialog" className="max-w-[560px] gap-md p-md">
				{/* pr-8 reserves room for the DialogContent's absolute close (X) so it can't overlap Reload. */}
				<div className="flex items-center justify-between gap-sm pr-8">
					<DialogTitle className="text-sm text-text">Skills</DialogTitle>
					{workspace ? (
						<Button
							size="sm"
							variant="outline"
							data-testid="skills-reload"
							disabled={busy || workspace.streaming}
							title={
								workspace.streaming
									? "Available once the current turn finishes"
									: "Apply to this chat"
							}
							onClick={() => void reload()}
						>
							<RefreshCw className="size-3.5" />
							Reload
						</Button>
					) : null}
				</div>

				{workspace?.stale ? (
					<div
						data-testid="skills-stale"
						className="rounded-[var(--radius-md)] border border-border2 bg-elevated px-md py-sm text-muted text-xs"
					>
						This worktree's skills changed on disk — <span className="text-text">Reload</span> to
						apply them to this chat.
					</div>
				) : null}

				{untrustedCount > 0 ? (
					<div
						data-testid="skills-trust-all"
						className="flex items-center gap-sm rounded-[var(--radius-md)] border border-border2 border-l-[3px] border-l-[var(--gold)] bg-[var(--gold-tint)] px-md py-sm"
					>
						<span className="min-w-0 flex-1 text-sm text-text">
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
						<p className="px-sm py-md text-hint text-sm">Loading skills…</p>
					) : entries.length === 0 ? (
						<p className="px-sm py-md text-hint text-sm">No skills discovered.</p>
					) : (
						<>
							{/* First-party skills (ThinkRail + Pi) lead, above the all-plugins master. */}
							{leadingGroups.map(renderGroup)}
							{/* Once the first-party groups scroll past, the all-plugins master pins at the scroll top
							    (higher z, fixed h-8); plugin/other headers stick below it at `top-8` — a two-level sticky. */}
							{hasPlugins ? (
								<div
									data-testid="skills-all-plugins"
									className="sticky top-0 z-20 flex h-8 items-center gap-sm border-border2 border-y bg-bg-dark px-sm"
								>
									<span className="min-w-0 flex-1 font-medium text-text text-xs uppercase tracking-wide">
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

/** A small on/off pill toggle (group + all-plugins controls). */
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
				"shrink-0 rounded-[var(--radius-sm)] border px-sm py-0.5 text-xs transition-colors disabled:opacity-50",
				on
					? "border-[var(--primary-40)] bg-[var(--primary-10)] text-primary"
					: "border-border2 text-muted hover:bg-hover",
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
	/** The skill's group (or the all-plugins master) is disabled — toggling this one skill won't apply. */
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
			className="flex items-center gap-sm py-1.5 pr-sm pl-md hover:bg-hover"
		>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-[var(--font-mono)] text-sm text-text">{entry.name}</span>
				{entry.description ? (
					<span className="truncate text-hint text-xs">{entry.description}</span>
				) : null}
			</span>
			{entry.decision === "pending-ack" ? (
				<Button size="sm" data-testid="skill-ack" disabled={busy} onClick={onAcknowledge}>
					<ShieldCheck className="size-3.5" />
					Enable
				</Button>
			) : entry.decision === "untrusted" ? (
				<span className="shrink-0 text-hint text-xs">{DECISION_TEXT.untrusted}</span>
			) : groupOff ? (
				<span className="shrink-0 text-hint text-xs" title="Enable the group to change this skill">
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
						"shrink-0 rounded-[var(--radius-sm)] border px-sm py-0.5 text-xs transition-colors disabled:opacity-50",
						loaded
							? "border-[var(--primary-40)] bg-[var(--primary-10)] text-primary"
							: "border-border2 text-muted hover:bg-hover",
					)}
				>
					{DECISION_TEXT[entry.decision]}
				</button>
			)}
		</div>
	);
}
