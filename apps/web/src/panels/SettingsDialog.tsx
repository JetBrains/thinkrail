import type { GithubAuthStatus } from "@thinkrail-pi/contracts";
import { Check, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getTransport } from "@/transport";

/**
 * App settings (the "Local GitHub" block). Shows the host's read-only `gh` auth status — Connected
 * with the account login, or Not connected (with the same graceful degrade the New-Workspace dialog uses)
 * — and a Refresh that re-probes `gh`.
 */
export function SettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [gh, setGh] = useState<GithubAuthStatus | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		getTransport()
			.request("github.authStatus", {})
			.then((s) => !cancelled && setGh(s))
			.catch(() => !cancelled && setGh({ connected: false }));
		return () => {
			cancelled = true;
		};
	}, [open]);

	const refresh = async () => {
		setRefreshing(true);
		try {
			setGh(await getTransport().request("github.refresh", {}));
		} catch {
			setGh({ connected: false });
		} finally {
			setRefreshing(false);
		}
	};

	const connected = gh?.connected ?? false;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="settings-dialog" className="max-w-[28rem]">
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>

				<section className="flex flex-col gap-sm">
					<h3 className="font-medium text-muted text-xs uppercase tracking-wider">Local GitHub</h3>
					<div className="flex items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm">
						<span
							data-testid="settings-gh-status"
							data-connected={connected}
							className={`inline-flex items-center gap-xs font-medium text-sm ${
								connected ? "text-green" : "text-hint"
							}`}
						>
							{connected ? <Check className="size-3.5" /> : <X className="size-3.5" />}
							{connected ? "Connected" : "Not connected"}
						</span>
						{connected && gh?.login ? (
							<span className="truncate text-muted text-sm">{gh.login}</span>
						) : null}
						<Button
							variant="outline"
							size="sm"
							data-testid="settings-gh-refresh"
							disabled={refreshing}
							onClick={() => void refresh()}
							className="ml-auto"
						>
							<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
							Refresh
						</Button>
					</div>
					<p className="text-hint text-xs">
						The GitHub CLI (<code className="font-[var(--font-mono)]">gh</code>) is read locally on
						the host. Authenticate with{" "}
						<code className="font-[var(--font-mono)]">gh auth login</code> to enable creating
						workspaces from remote branches.
					</p>
				</section>
			</DialogContent>
		</Dialog>
	);
}
