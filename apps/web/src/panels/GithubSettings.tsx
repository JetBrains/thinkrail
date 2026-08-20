import type { GithubAuthStatus } from "@thinkrail/contracts";
import { Check, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getTransport } from "@/transport";

export function GithubSettings() {
	const [gh, setGh] = useState<GithubAuthStatus | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("github.authStatus", {})
			.then((s) => !cancelled && setGh(s))
			.catch(() => !cancelled && setGh({ connected: false }));
		return () => {
			cancelled = true;
		};
	}, []);

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
		<section data-testid="settings-github" className="flex flex-col gap-sm">
			<div className="flex flex-col gap-xs">
				<h3 className="tr-title-section text-text-default">Local GitHub</h3>
				<p className="text-text-muted tr-text-metadata">
					Authenticate the GitHub CLI to create workspaces from remote branches.
				</p>
			</div>
			<div className="flex items-center gap-sm rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm">
				<span
					data-testid="settings-gh-status"
					data-connected={connected}
					className={`inline-flex items-center gap-xs tr-text-ui ${
						connected ? "text-feedback-success" : "text-text-muted"
					}`}
				>
					{connected ? <Check className="size-3.5" /> : <X className="size-3.5" />}
					{connected ? "Connected" : "Not connected"}
				</span>
				{connected && gh?.login ? (
					<span className="truncate text-text-muted tr-text-ui">{gh.login}</span>
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
			<p className="text-text-muted tr-text-metadata">
				The GitHub CLI (<code className="tr-code-text">gh</code>) is read locally on the host.
				Authenticate with <code className="tr-code-text">gh auth login</code> to enable creating
				workspaces from remote branches.
			</p>
		</section>
	);
}
