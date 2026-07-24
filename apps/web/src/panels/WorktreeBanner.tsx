import type { Workspace } from "@thinkrail/contracts";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markBannerDismissed } from "@/onboarding";
import { useAppStore } from "@/store";

/**
 * One-time "you are in a separate folder" cue, shown on every worktree-workspace activation until
 * dismissed once — cross-client (the flag lives in AppConfig: the user learns once, not per device).
 * #105 integration: also skip the built-in Default workspace (`workspace.kind === "default"`) when
 * `Workspace.kind` lands on the wire.
 */
export function WorktreeBanner({ workspace }: { workspace: Workspace }) {
	const appConfig = useAppStore((s) => s.appConfig);
	const openOnboarding = useAppStore((s) => s.openOnboarding);
	if (!appConfig || appConfig.onboarding?.workspaceBannerDismissedAt) return null;
	return (
		<div
			data-testid="worktree-banner"
			className="flex items-center gap-sm border-border2 border-b bg-primary/10 px-md py-sm text-sm"
		>
			<Info className="size-4 shrink-0 text-primary" />
			<p className="min-w-0 flex-1 truncate text-muted">
				This workspace lives at{" "}
				<span className="font-[var(--font-mono)] text-text">{workspace.worktreePath}</span> — a
				separate folder on branch{" "}
				<span className="font-[var(--font-mono)] text-text">{workspace.branch}</span>.
			</p>
			<Button
				variant="ghost"
				size="sm"
				data-testid="worktree-banner-how"
				onClick={() => openOnboarding("review", "game")}
			>
				How it works
			</Button>
			<Button
				variant="ghost"
				size="sm"
				data-testid="worktree-banner-dismiss"
				onClick={markBannerDismissed}
			>
				Got it
			</Button>
		</div>
	);
}
