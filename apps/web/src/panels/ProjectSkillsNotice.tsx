import type { Project } from "@thinkrail/contracts";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

/**
 * The per-project trust + new-skill surface for pre-workspace contexts (the Welcome view). **Presence-
 * gated:** renders nothing unless the project's checkout actually ships committed alias skills, and shows a
 * COUNT — never the skills' (attacker-controlled) names/descriptions — before trust. Granting trust
 * acknowledges the skills present now; ones that appear later (a pull/branch) surface a "review" affordance
 * that acknowledges them. Grants/acks echo the updated `Project` back, which we fold into the store.
 */
export function ProjectSkillsNotice({ projectId }: { projectId: string }) {
	const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
	const [aliasSkills, setAliasSkills] = useState<string[] | null>(null);
	const [busy, setBusy] = useState(false);

	// The committed alias skills present in the project's current checkout (a count only — degrades to none).
	useEffect(() => {
		let cancelled = false;
		setAliasSkills(null);
		getTransport()
			.request("project.aliasSkills", { projectId })
			.then((names) => {
				if (!cancelled) setAliasSkills(names);
			})
			.catch(() => {
				if (!cancelled) setAliasSkills([]);
			});
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	if (!project || !aliasSkills || aliasSkills.length === 0) return null;

	const trusted = project.trusted === true;
	const acknowledged = new Set(project.acknowledgedSkills ?? []);
	const pending = trusted ? aliasSkills.filter((name) => !acknowledged.has(name)) : [];
	const count = aliasSkills.length;
	const plural = (n: number) => (n === 1 ? "" : "s");

	const applyProject = (updated: Project) => {
		const store = useAppStore.getState();
		store.setProjects(store.projects.map((p) => (p.id === updated.id ? updated : p)));
	};

	const run = async (request: () => Promise<Project>, failure: string) => {
		if (busy) return;
		setBusy(true);
		try {
			applyProject(await request());
		} catch (err) {
			toast.error(errorText(err), failure);
		} finally {
			setBusy(false);
		}
	};

	// Trusted with nothing new pending → a quiet confirmation line, no action.
	if (trusted && pending.length === 0) {
		return (
			<p
				data-testid="project-skills-notice"
				data-state="trusted"
				className="mt-lg flex items-center gap-xs text-hint text-xs"
			>
				<ShieldCheck className="size-3.5 shrink-0 text-gold" />
				{count} project skill{plural(count)} trusted.
			</p>
		);
	}

	const isPending = trusted && pending.length > 0;
	return (
		<div
			data-testid="project-skills-notice"
			data-state={isPending ? "pending" : "untrusted"}
			className="mt-lg flex w-full max-w-[560px] items-center gap-sm rounded-[var(--radius-md)] border border-border2 border-l-[3px] border-l-[var(--gold)] bg-[var(--gold-tint)] px-md py-sm text-left"
		>
			<TriangleAlert className="size-4 shrink-0 text-gold" />
			<span className="min-w-0 flex-1 text-sm text-text">
				{isPending
					? `${pending.length} new skill${plural(pending.length)} appeared since you trusted this project.`
					: `This project ships ${count} skill${plural(count)} — off until you trust it.`}
			</span>
			<Button
				size="sm"
				data-testid={isPending ? "project-ack-button" : "project-trust-button"}
				disabled={busy}
				onClick={() =>
					void run(
						isPending
							? () =>
									getTransport().request("project.acknowledgeSkills", {
										id: projectId,
										names: pending,
									})
							: () => getTransport().request("project.setTrust", { id: projectId, trusted: true }),
						isPending ? "Couldn't confirm skills" : "Couldn't trust project",
					)
				}
			>
				{isPending ? "Review & enable" : "Trust project"}
			</Button>
		</div>
	);
}
