import { RiCheckLine as Check, RiRefreshLine as RefreshCw } from "@remixicon/react";
import type { GithubAuthStatus } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { getTransport } from "@/transport";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";

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
	const refreshButton = (
		<Button
			variant="outline"
			size="sm"
			data-testid="settings-gh-refresh"
			disabled={refreshing}
			onClick={() => void refresh()}
		>
			<RefreshCw className={cn("size-14", refreshing && "animate-spin")} />
			Refresh
		</Button>
	);

	return (
		<div data-testid="settings-github" className="flex flex-col">
			<SettingsGroup
				title="Local GitHub"
				description="Authenticate the GitHub CLI to create workspaces from remote branches."
			>
				<div data-testid="settings-gh-status" data-connected={connected}>
					{connected ? (
						<div className="flex items-center gap-8 rounded-sm bg-control-bg px-12 py-8">
							<Check className="size-14 text-feedback-success" />
							<span className="tr-text-ui text-feedback-success">Connected</span>
							{gh?.login ? (
								<span className="min-w-0 truncate text-text-muted tr-text-metadata">
									{gh.login}
								</span>
							) : null}
							<div className="ml-auto shrink-0">{refreshButton}</div>
						</div>
					) : (
						<SettingsNotice variant="warning" action={refreshButton}>
							<p>
								Not connected. Run <code className="tr-code-text">gh auth login</code> in a
								terminal, then Refresh.
							</p>
						</SettingsNotice>
					)}
				</div>
			</SettingsGroup>
		</div>
	);
}
