import type { Project, SkillCatalogEntry, SkillDecision, Workspace } from "@thinkrail/contracts";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

/** The workspace-scoped Skills manager (opened from the chat header). Lists every discovered skill grouped
 * by source with its admission verdict, exposes trust + per-workspace enable/disable + re-confirm-new, and
 * a Reload that applies changes to *this* chat's running session. */
const FIXED_HINT: Record<string, string> = {
	Project: "Committed to the repo — gated behind trust.",
	Personal: "Your own libraries (~/.claude, ~/.codex, …).",
	Bundled: "Shipped with ThinkRail.",
	Pi: "Pi-native / configured.",
};
const FIXED_RANK: Record<string, number> = { Project: 0, Personal: 1, Bundled: 3, Pi: 4 };

function fixedLabel(entry: SkillCatalogEntry): "Project" | "Personal" | "Bundled" | "Pi" {
	if (entry.gated) return "Project";
	if (entry.sourceInfo.scope === "user") return "Personal";
	if (entry.sourceInfo.scope === "temporary") return "Bundled";
	return "Pi";
}

/** Group entries by installing plugin (if any), else by source tier; order Project → Personal → plugins
 * (sorted) → Bundled → Pi, so a plugin's skills sit together under the plugin's name. */
function groupCatalog(
	entries: SkillCatalogEntry[],
): { label: string; hint: string; items: SkillCatalogEntry[] }[] {
	const byLabel = new Map<string, { isPlugin: boolean; items: SkillCatalogEntry[] }>();
	for (const entry of entries) {
		const label = entry.plugin ?? fixedLabel(entry);
		const group = byLabel.get(label) ?? { isPlugin: Boolean(entry.plugin), items: [] };
		group.items.push(entry);
		byLabel.set(label, group);
	}
	return [...byLabel.entries()]
		.map(([label, group]) => ({
			label,
			hint: group.isPlugin ? "Claude plugin" : (FIXED_HINT[label] ?? ""),
			items: group.items,
			rank: group.isPlugin ? 2 : (FIXED_RANK[label] ?? 5),
		}))
		.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
		.map(({ label, hint, items }) => ({ label, hint, items }));
}

/** A skill result carries `projectId` only when it's a Workspace; Project has no such field. */
function isWorkspace(result: Project | Workspace): result is Workspace {
	return "projectId" in result;
}

/** Whether a worktree-relative path is inside a skill directory — the auto-detect trigger for a reload. */
export function isSkillPath(path: string): boolean {
	return /(^|\/)\.(claude|github|gemini|pi|agents)\/skills(\/|$)/.test(path);
}

export function SkillsDialog({
	workspaceId,
	sessionId,
	projectId,
	streaming,
	stale,
	open,
	onOpenChange,
	onReloaded,
}: {
	workspaceId: string;
	sessionId: string;
	projectId: string;
	streaming: boolean;
	/** The worktree's skills changed on disk since this session loaded (pull/branch/edit) — prompt a reload. */
	stale?: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Fired after a successful reload so the caller can clear its stale flag. */
	onReloaded?: () => void;
}) {
	const [entries, setEntries] = useState<SkillCatalogEntry[] | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setEntries(await getTransport().request("skills.state", { workspaceId }));
		} catch {
			setEntries([]);
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!open) return;
		setEntries(null);
		void refresh();
	}, [open, refresh]);

	// Fold a mutation's echoed record back into the store (Project only — a Workspace update also arrives on
	// the workspace.updated push), then re-read the catalog so decisions reflect the change.
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
		if (busy) return;
		setBusy(true);
		try {
			await getTransport().request("session.reloadResources", { sessionId });
			onReloaded?.();
			toast.success("This chat now uses the updated skills.", "Skills reloaded");
		} catch (err) {
			toast.error(errorText(err), "Couldn't reload skills");
		} finally {
			setBusy(false);
		}
	};

	const untrustedCount = entries?.filter((e) => e.decision === "untrusted").length ?? 0;
	const grouped = groupCatalog(entries ?? []);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="skills-dialog" className="max-w-[560px] gap-md p-md">
				<div className="flex items-center justify-between gap-sm">
					<DialogTitle className="text-sm text-text">Skills</DialogTitle>
					<Button
						size="sm"
						variant="outline"
						data-testid="skills-reload"
						disabled={busy || streaming}
						title={streaming ? "Available once the current turn finishes" : "Apply to this chat"}
						onClick={() => void reload()}
					>
						<RefreshCw className="size-3.5" />
						Reload
					</Button>
				</div>

				{stale ? (
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
						<p className="px-sm py-md text-hint text-sm">
							No skills discovered for this workspace.
						</p>
					) : (
						grouped.map(({ label, hint, items }) => (
							<div
								key={label}
								data-testid="skill-group"
								data-group={label}
								className="mb-md overflow-hidden rounded-[var(--radius-md)] border border-border2"
							>
								<div className="flex items-baseline gap-sm border-border2 border-b bg-bg-dark px-sm py-1.5">
									<span className="font-medium text-text text-xs uppercase tracking-wide">
										{label}
									</span>
									<span className="min-w-0 flex-1 truncate text-hint text-xs">{hint}</span>
									<span className="shrink-0 rounded-full bg-hover px-1.5 text-hint text-xs">
										{items.length}
									</span>
								</div>
								<div className="divide-y divide-border2">
									{items.map((entry) => (
										<SkillRow
											key={`${label}:${entry.name}`}
											entry={entry}
											busy={busy}
											onToggle={(enabled) =>
												void mutate(
													() =>
														getTransport().request("workspace.setSkillOverride", {
															id: workspaceId,
															name: entry.name,
															override: enabled ? "on" : "off",
														}),
													"Couldn't update skill",
												)
											}
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
						))
					)}
				</div>
			</DialogContent>
		</Dialog>
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
	onToggle,
	onAcknowledge,
}: {
	entry: SkillCatalogEntry;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onAcknowledge: () => void;
}) {
	const loaded = entry.decision === "load";
	return (
		<div
			data-testid="skill-row"
			data-skill={entry.name}
			data-decision={entry.decision}
			className="flex items-center gap-sm px-sm py-1.5 hover:bg-hover"
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
