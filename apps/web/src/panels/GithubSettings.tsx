import { RiCheckLine as Check, RiRefreshLine as RefreshCw } from "@remixicon/react";
import type { GithubAuthStatus } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { getTransport } from "@/transport";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SETTINGS_ROWS_CONTAINER } from "./SettingsRow";

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
		<div data-testid="settings-github" className={`${SETTINGS_ROWS_CONTAINER} gap-24`}>
			<SettingsGroup
				title="GitHub CLI"
				description="Authenticate to create workspaces from remote branches."
			>
				{connected ? (
					// Compact success state with subtle background - no refresh button
					<div
						data-testid="settings-gh-status"
						data-connected="true"
						className="flex items-center gap-8 rounded-sm bg-control-bg px-12 py-8"
					>
						<Check className="size-14 text-feedback-success" />
						<span className="tr-text-ui text-feedback-success">Connected</span>
						{gh?.login && (
							<span className="truncate text-text-muted tr-text-metadata">{gh.login}</span>
						)}
					</div>
				) : (
					// Error state with contextual notice
					<SettingsNotice
						variant="warning"
						testId="settings-gh-status"
						action={
							<Button
								variant="outline"
								size="sm"
								data-testid="settings-gh-refresh"
								disabled={refreshing}
								onClick={() => void refresh()}
							>
								<RefreshCw className={`size-14 ${refreshing ? "animate-spin" : ""}`} />
								Refresh
							</Button>
						}
					>
						<p>
							GitHub CLI is not connected. Run <code className="tr-code-text">gh auth login</code>{" "}
							in a terminal to connect.
						</p>
					</SettingsNotice>
				)}
			</SettingsGroup>
		</div>
	);
}
