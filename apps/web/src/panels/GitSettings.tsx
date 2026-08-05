import type { AppConfig } from "@thinkrail/contracts";
import { CloudOff, GitCompare, type LucideIcon, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

type RemoteCheckMode = AppConfig["gitRemoteCheck"];

const MODES: { id: RemoteCheckMode; label: string; description: string; icon: LucideIcon }[] = [
	{
		id: "probe",
		label: "Probe",
		description: "Write-nothing check — sees that a branch moved, not by how much.",
		icon: GitCompare,
	},
	{
		id: "fetch",
		label: "Fetch",
		description: "A real git fetch — exact counts, but moves local remote-tracking refs.",
		icon: RefreshCw,
	},
	{
		id: "off",
		label: "Off",
		description: "No automatic checks. Fetch manually from a workspace's indicator.",
		icon: CloudOff,
	},
];

/**
 * The "Git" settings section: the remote-check mode (`probe`/`fetch`/`off`) and the backstop interval
 * between automatic checks. Server-synced — both fields fire a single `settings.update` and the UI
 * converges on the host's `settings.changed` broadcast (no optimistic apply), the same pattern as the
 * Privacy toggle and the theme picker. The authoritative `[1, 1440]`-minute clamp and unknown-mode
 * rejection live server-side in `updateConfig`; the bound here is a light sanity check only (don't send
 * an empty or non-positive value), not a re-implementation of that clamp.
 */
export function GitSettings() {
	const mode = useAppStore((s) => s.gitRemoteCheck);
	const intervalMinutes = useAppStore((s) => s.gitRemoteCheckIntervalMinutes);
	const [intervalInput, setIntervalInput] = useState(String(intervalMinutes));
	const [editingInterval, setEditingInterval] = useState(false);

	// The store's own value always wins once `settings.changed` lands — but not while the field is
	// focused, or a converged value would yank a digit out from under an in-progress edit.
	useEffect(() => {
		if (!editingInterval) setIntervalInput(String(intervalMinutes));
	}, [intervalMinutes, editingInterval]);

	const setMode = (next: RemoteCheckMode) => {
		getTransport()
			.request("settings.update", { config: { gitRemoteCheck: next } })
			.catch(() => toast.error("Couldn't change the remote-check mode"));
	};

	const commitInterval = () => {
		setEditingInterval(false);
		const parsed = Number(intervalInput);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			setIntervalInput(String(intervalMinutes));
			return;
		}
		getTransport()
			.request("settings.update", { config: { gitRemoteCheckIntervalMinutes: Math.round(parsed) } })
			.catch(() => toast.error("Couldn't change the remote-check interval"));
	};

	return (
		<section data-testid="settings-git" className="flex flex-col gap-lg">
			<div className="flex flex-col gap-xs">
				<h3 className="tr-title-section text-text-default">Remote checks</h3>
				<p className="text-text-subtle tr-text-metadata">
					ThinkRail can periodically check whether a workspace's base branch has moved on its
					remote, showing a ↓ indicator when it has. Probing never touches your local
					remote-tracking refs, so it never interferes with a force-push you're mid-way through.
				</p>
			</div>

			<fieldset data-testid="git-remote-check-mode" className="flex flex-col gap-xs">
				<legend className="sr-only">Remote-check mode</legend>
				{MODES.map(({ id, label, description, icon: Icon }) => {
					const active = mode === id;
					return (
						<label
							key={id}
							data-testid={`git-remote-check-mode-${id}`}
							data-active={active}
							className={cn(
								"flex items-center gap-md rounded-[var(--radius-md)] border px-md py-sm transition-colors",
								active
									? "border-primary bg-primary-subtle"
									: "border-border-default hover:bg-control-bg-hovered",
							)}
						>
							<input
								type="radio"
								name="git-remote-check-mode"
								className="sr-only"
								checked={active}
								onChange={() => setMode(id)}
							/>
							<Icon
								className={cn("size-4 shrink-0", active ? "text-primary" : "text-text-muted")}
							/>
							<div className="flex flex-col gap-0.5">
								<span
									className={cn("tr-title-compact", active ? "text-primary" : "text-text-default")}
								>
									{label}
								</span>
								<span className="text-text-subtle tr-text-metadata">{description}</span>
							</div>
						</label>
					);
				})}
			</fieldset>

			<div className="flex flex-col gap-xs">
				<label htmlFor="git-remote-check-interval" className="tr-title-compact text-text-default">
					Check interval
				</label>
				<p className="text-text-subtle tr-text-metadata">
					How often to check when no other trigger (opening the app, a workspace's own activity) has
					done it recently. Minutes, from 1 to 1440 (24 hours).
				</p>
				<input
					id="git-remote-check-interval"
					data-testid="git-remote-check-interval"
					type="number"
					min={1}
					max={1440}
					disabled={mode === "off"}
					value={intervalInput}
					onFocus={() => setEditingInterval(true)}
					onChange={(e) => setIntervalInput(e.target.value)}
					onBlur={commitInterval}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
					}}
					className="h-8 w-24 rounded-[var(--radius-md)] border border-border-default bg-container-workspace-bg px-sm tr-text-ui text-text-default outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
				/>
			</div>
		</section>
	);
}
