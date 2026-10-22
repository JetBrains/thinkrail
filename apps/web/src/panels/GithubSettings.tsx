import { RiCheckLine as Check, RiRefreshLine as RefreshCw } from "@remixicon/react";
import type { GithubAuthStatus } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { getTransport } from "@/transport";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";

export function GithubSettings() {
	const t = useT();
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
		const load = async () => setGh(await getTransport().request("github.refresh", {}));
		await load()
			.catch(() => setGh({ connected: false }))
			.finally(() => setRefreshing(false));
	};

	const connected = gh?.connected ?? false;
	const refreshButton = (
		<Button
			variant="outline"
			size="m"
			iconLeft={RefreshCw}
			loading={refreshing}
			data-testid="settings-gh-refresh"
			onClick={() => void refresh()}
		>
			{t("settings.github.refresh")}
		</Button>
	);

	return (
		<div data-testid="settings-github" className="flex flex-col">
			<SettingsGroup
				title={t("settings.github.title")}
				description={t("settings.github.description")}
			>
				<div data-testid="settings-gh-status" data-connected={connected}>
					{connected ? (
						<div className="flex items-center gap-8 rounded-sm bg-control-bg px-12 py-8">
							<Check className="size-14 text-feedback-success" />
							<span className="tr-text-ui text-feedback-success">
								{t("settings.github.connected")}
							</span>
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
								<T
									i18nKey="settings.github.notConnected"
									components={[<code key="command" className="tr-code-text" />]}
								/>
							</p>
						</SettingsNotice>
					)}
				</div>
			</SettingsGroup>
		</div>
	);
}
