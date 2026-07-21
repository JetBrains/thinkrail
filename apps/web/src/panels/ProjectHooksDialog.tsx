import type { HookName } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "../store";
import { errorText } from "../transport";
import { approveProjectHook, getProjectHooks, saveProjectHooks } from "./hooksActions";

const HOOKS: { name: HookName; label: string; description: string }[] = [
	{
		name: "onCreate",
		label: "onCreate",
		description: "Runs once, right after a workspace is created.",
	},
	{
		name: "onDelete",
		label: "onDelete",
		description: "Runs before a workspace's worktree is removed.",
	},
	{
		name: "preMerge",
		label: "preMerge",
		description: "Runs before a merge; a non-zero exit blocks it. (No merge flow exists yet.)",
	},
	{
		name: "postMerge",
		label: "postMerge",
		description: "Runs in the background after a successful merge. (No merge flow exists yet.)",
	},
];

type FieldState = {
	command: string;
	overrideEnabled: boolean;
	override: string;
	approved: boolean;
};

function emptyField(): FieldState {
	return { command: "", overrideEnabled: false, override: "", approved: false };
}

/**
 * The project-level hooks config surface — one row per `HookName`, reachable with zero workspaces (this
 * dialog's own `project.hooks.get`/`.save` calls need only a `projectId`). Saving writes + commits
 * `.thinkrail/hooks.json` in the project's root checkout and the host-local override map; it never
 * auto-approves — trusting a command to actually run is a separate, explicit click here (or later, via the
 * reactive per-workspace approval dialog).
 */
export function ProjectHooksDialog({
	open,
	projectId,
	projectName,
	onOpenChange,
}: {
	open: boolean;
	projectId: string;
	projectName: string;
	onOpenChange: (open: boolean) => void;
}) {
	const [fields, setFields] = useState<Record<HookName, FieldState>>(() => ({
		onCreate: emptyField(),
		onDelete: emptyField(),
		preMerge: emptyField(),
		postMerge: emptyField(),
	}));
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		getProjectHooks(projectId)
			.then(({ committed, overrides, approved }) => {
				setFields({
					onCreate: fieldFrom("onCreate", committed, overrides, approved),
					onDelete: fieldFrom("onDelete", committed, overrides, approved),
					preMerge: fieldFrom("preMerge", committed, overrides, approved),
					postMerge: fieldFrom("postMerge", committed, overrides, approved),
				});
			})
			.catch((err) => toast.error(errorText(err, "Failed to load hooks")))
			.finally(() => setLoading(false));
	}, [open, projectId]);

	const setField = (hook: HookName, patch: Partial<FieldState>) =>
		setFields((prev) => ({ ...prev, [hook]: { ...prev[hook], ...patch } }));

	const resolvedCommand = (hook: HookName): string => {
		const f = fields[hook];
		return f.overrideEnabled && f.override.trim() ? f.override.trim() : f.command.trim();
	};

	const save = async () => {
		setSaving(true);
		try {
			const committed: Partial<Record<HookName, string>> = {};
			const overrides: Partial<Record<HookName, string>> = {};
			for (const { name } of HOOKS) {
				const f = fields[name];
				if (f.command.trim()) committed[name] = f.command.trim();
				if (f.overrideEnabled && f.override.trim()) overrides[name] = f.override.trim();
			}
			await saveProjectHooks(projectId, committed, overrides);
			const refreshed = await getProjectHooks(projectId);
			setFields({
				onCreate: fieldFrom(
					"onCreate",
					refreshed.committed,
					refreshed.overrides,
					refreshed.approved,
				),
				onDelete: fieldFrom(
					"onDelete",
					refreshed.committed,
					refreshed.overrides,
					refreshed.approved,
				),
				preMerge: fieldFrom(
					"preMerge",
					refreshed.committed,
					refreshed.overrides,
					refreshed.approved,
				),
				postMerge: fieldFrom(
					"postMerge",
					refreshed.committed,
					refreshed.overrides,
					refreshed.approved,
				),
			});
			toast.success("Hooks saved");
			onOpenChange(false);
		} catch (err) {
			toast.error(errorText(err, "Failed to save hooks"));
		} finally {
			setSaving(false);
		}
	};

	const approve = async (hook: HookName) => {
		const command = resolvedCommand(hook);
		if (!command) return;
		try {
			await approveProjectHook(projectId, hook, command);
			setField(hook, { approved: true });
		} catch (err) {
			toast.error(errorText(err, `Failed to approve ${hook}`));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="project-hooks-dialog" className="max-w-[520px] gap-md">
				<DialogHeader>
					<DialogTitle>Hooks — {projectName}</DialogTitle>
				</DialogHeader>
				{loading ? (
					<p className="text-hint text-sm">Loading…</p>
				) : (
					<div className="flex flex-col gap-lg">
						{HOOKS.map(({ name, label, description }) => {
							const f = fields[name];
							const command = resolvedCommand(name);
							return (
								<div key={name} className="flex flex-col gap-xs" data-testid={`hook-field-${name}`}>
									<label className="font-medium text-sm text-text" htmlFor={`hook-${name}`}>
										{label}
									</label>
									<p className="text-hint text-xs">{description}</p>
									<input
										id={`hook-${name}`}
										data-testid={`hook-command-${name}`}
										value={f.command}
										onChange={(e) => setField(name, { command: e.target.value })}
										placeholder="e.g. npm install"
										className="rounded-[var(--radius-md)] border border-border2 bg-bg px-sm py-xs font-[var(--font-mono)] text-sm text-text outline-none placeholder:text-hint focus:border-primary"
									/>
									<label className="flex items-center gap-xs text-hint text-xs">
										<input
											type="checkbox"
											data-testid={`hook-override-toggle-${name}`}
											checked={f.overrideEnabled}
											onChange={(e) => setField(name, { overrideEnabled: e.target.checked })}
										/>
										Override on this machine
									</label>
									{f.overrideEnabled && (
										<input
											data-testid={`hook-override-${name}`}
											value={f.override}
											onChange={(e) => setField(name, { override: e.target.value })}
											placeholder="Never committed — just for you"
											className="rounded-[var(--radius-md)] border border-border2 bg-bg px-sm py-xs font-[var(--font-mono)] text-sm text-text outline-none placeholder:text-hint focus:border-primary"
										/>
									)}
									{command && (
										<div className="flex items-center gap-sm text-xs">
											<span
												data-testid={`hook-approved-${name}`}
												className={f.approved ? "text-green" : "text-hint"}
											>
												{f.approved ? "Approved" : "Not yet approved"}
											</span>
											{!f.approved && (
												<button
													type="button"
													data-testid={`hook-approve-${name}`}
													onClick={() => void approve(name)}
													className="text-primary hover:underline"
												>
													Approve
												</button>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
				<div className="flex justify-end gap-sm">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
						Cancel
					</Button>
					<Button data-testid="save-hooks" onClick={() => void save()} disabled={loading || saving}>
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function fieldFrom(
	hook: HookName,
	committed: Partial<Record<HookName, string>>,
	overrides: Partial<Record<HookName, string>>,
	approved: Partial<Record<HookName, boolean>>,
): FieldState {
	return {
		command: committed[hook] ?? "",
		overrideEnabled: overrides[hook] != null,
		override: overrides[hook] ?? "",
		approved: approved[hook] ?? false,
	};
}
